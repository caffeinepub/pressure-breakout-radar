/**
 * aggTradeWs.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * WebSocket-based aggTrade stream manager for Binance USDT-M Futures.
 *
 * Provides a rolling in-memory buffer of aggTrades per symbol, kept alive
 * by a persistent WebSocket connection.  The monitor loop reads from this
 * buffer instead of polling REST on every tick.
 *
 * REST endpoint is only called once for bootstrap (pre-fill) and is never
 * retried after a 418 / 429 response until the ban window expires.
 *
 * Public surface:
 *   subscribeAggTradeStream(symbol)  → attach a listener; returns unsubscribe()
 *   getAggTradeBuffer(symbol)        → current rolling buffer for a symbol
 *   getWsStatus(symbol)              → current connection status label
 *   bootstrapRestAggTrades(symbol)   → one-shot REST pre-fill (handles bans)
 */

import type { BinanceAggTrade } from "./binanceApi";

const WS_BASE = "wss://fstream.binance.com/ws";
const REST_BASE = "https://fapi.binance.com";

// Rolling buffer: keep trades from the last BUFFER_WINDOW_MS (20 min).
// This covers all three timeframes (1m/5m/15m) for bubble bucketing.
const BUFFER_WINDOW_MS = 20 * 60 * 1000;
// Hard cap to avoid unbounded memory growth on very active symbols.
const BUFFER_MAX_TRADES = 8000;

// WebSocket reconnect: exponential back-off capped at 30s.
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

// ── REST ban tracking ───────────────────────────────────────────────────────
// Shared across all symbols: a 418/429 from Binance is an IP-level ban.
let restBannedUntil = 0; // epoch ms

function isRestBanned(): boolean {
  return Date.now() < restBannedUntil;
}

function applyRestBan(retryAfterSeconds?: number) {
  const wait = retryAfterSeconds ? retryAfterSeconds * 1000 : 60_000; // default 60s if no header
  restBannedUntil = Date.now() + wait;
  console.warn(
    `[aggTradeWs] REST ban applied until ${new Date(restBannedUntil).toISOString()} (${Math.round(wait / 1000)}s)`,
  );
}

// ── Per-symbol state ────────────────────────────────────────────────────────
export type WsStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "LIVE"
  | "RECONNECTING"
  | "ERROR";

interface SymbolState {
  buffer: BinanceAggTrade[];
  ws: WebSocket | null;
  wsStatus: WsStatus;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempt: number;
  subscribers: Set<() => void>;
  destroyed: boolean;
}

const symbolStates = new Map<string, SymbolState>();

function getOrCreate(symbol: string): SymbolState {
  if (!symbolStates.has(symbol)) {
    symbolStates.set(symbol, {
      buffer: [],
      ws: null,
      wsStatus: "DISCONNECTED",
      reconnectTimer: null,
      reconnectAttempt: 0,
      subscribers: new Set(),
      destroyed: false,
    });
  }
  return symbolStates.get(symbol)!;
}

// ── Buffer helpers ──────────────────────────────────────────────────────────
function pruneBuffer(state: SymbolState) {
  const cutoff = Date.now() - BUFFER_WINDOW_MS;
  // Remove old trades from the front
  let start = 0;
  while (start < state.buffer.length && state.buffer[start].T < cutoff) {
    start++;
  }
  if (start > 0) state.buffer.splice(0, start);
  // Hard cap
  if (state.buffer.length > BUFFER_MAX_TRADES) {
    state.buffer.splice(0, state.buffer.length - BUFFER_MAX_TRADES);
  }
}

function notifySubscribers(state: SymbolState) {
  for (const cb of state.subscribers) {
    try {
      cb();
    } catch {
      // ignore subscriber errors
    }
  }
}

// ── WebSocket lifecycle ─────────────────────────────────────────────────────
function connect(symbol: string) {
  const state = getOrCreate(symbol);
  if (state.destroyed) return;

  // Clean up any existing socket
  if (state.ws) {
    state.ws.onclose = null;
    state.ws.onerror = null;
    state.ws.onmessage = null;
    try {
      state.ws.close();
    } catch {
      /* ignore */
    }
    state.ws = null;
  }

  state.wsStatus = state.reconnectAttempt === 0 ? "CONNECTING" : "RECONNECTING";
  notifySubscribers(state);

  const url = `${WS_BASE}/${symbol.toLowerCase()}@aggTrade`;
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error(`[aggTradeWs] Failed to open WebSocket for ${symbol}:`, err);
    state.wsStatus = "ERROR";
    notifySubscribers(state);
    scheduleReconnect(symbol);
    return;
  }
  state.ws = ws;

  ws.onopen = () => {
    if (state.destroyed || state.ws !== ws) return;
    state.wsStatus = "LIVE";
    state.reconnectAttempt = 0;
    notifySubscribers(state);
  };

  ws.onmessage = (event) => {
    if (state.destroyed || state.ws !== ws) return;
    try {
      const msg = JSON.parse(event.data as string);
      // Binance aggTrade WS message shape:
      // { e: "aggTrade", T: timestamp, p: price, q: qty, m: isMaker }
      if (msg.e === "aggTrade") {
        const trade: BinanceAggTrade = {
          T: msg.T,
          p: msg.p,
          q: msg.q,
          m: msg.m,
        };
        state.buffer.push(trade);
        pruneBuffer(state);
        notifySubscribers(state);
      }
    } catch {
      // malformed message — ignore
    }
  };

  ws.onclose = (event) => {
    if (state.destroyed || state.ws !== ws) return;
    state.ws = null;
    state.wsStatus = event.wasClean ? "DISCONNECTED" : "RECONNECTING";
    notifySubscribers(state);
    if (!state.destroyed) scheduleReconnect(symbol);
  };

  ws.onerror = () => {
    if (state.destroyed || state.ws !== ws) return;
    state.wsStatus = "ERROR";
    notifySubscribers(state);
    // onclose will fire after onerror and handle reconnect
  };
}

function scheduleReconnect(symbol: string) {
  const state = getOrCreate(symbol);
  if (state.destroyed) return;
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);

  const delay = Math.min(
    RECONNECT_BASE_MS * 2 ** state.reconnectAttempt,
    RECONNECT_MAX_MS,
  );
  state.reconnectAttempt++;

  state.reconnectTimer = setTimeout(() => {
    if (!state.destroyed) connect(symbol);
  }, delay);
}

function teardown(symbol: string) {
  const state = symbolStates.get(symbol);
  if (!state) return;
  state.destroyed = true;
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  if (state.ws) {
    state.ws.onclose = null;
    state.ws.onerror = null;
    state.ws.onmessage = null;
    try {
      state.ws.close();
    } catch {
      /* ignore */
    }
    state.ws = null;
  }
  symbolStates.delete(symbol);
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Subscribe to a symbol's aggTrade stream.
 * Starts the WebSocket if not already connected.
 * Returns an unsubscribe function — call it when the monitor closes.
 */
export function subscribeAggTradeStream(
  symbol: string,
  onChange?: () => void,
): () => void {
  const state = getOrCreate(symbol);

  const cb = onChange ?? (() => {});
  state.subscribers.add(cb);

  // Start connection if needed
  if (
    !state.ws &&
    !state.reconnectTimer &&
    !state.destroyed &&
    state.wsStatus !== "CONNECTING"
  ) {
    state.reconnectAttempt = 0;
    connect(symbol);
  }

  return () => {
    state.subscribers.delete(cb);
    // Tear down if no more subscribers
    if (state.subscribers.size === 0) {
      teardown(symbol);
    }
  };
}

/**
 * Get the current rolling trade buffer for a symbol.
 * Returns a snapshot (reference, not copy — do not mutate).
 */
export function getAggTradeBuffer(symbol: string): BinanceAggTrade[] {
  return symbolStates.get(symbol)?.buffer ?? [];
}

/**
 * Get the current WebSocket connection status for a symbol.
 */
export function getWsStatus(symbol: string): WsStatus {
  return symbolStates.get(symbol)?.wsStatus ?? "DISCONNECTED";
}

/**
 * One-shot REST bootstrap: fetch recent aggTrades to pre-fill the buffer
 * before the WebSocket stream catches up.
 *
 * Respects REST ban: does nothing if currently banned.
 * On 429/418: applies the ban and returns false.
 */
export async function bootstrapRestAggTrades(
  symbol: string,
  limit = 1000,
): Promise<boolean> {
  if (isRestBanned()) {
    console.warn(`[aggTradeWs] REST banned — skipping bootstrap for ${symbol}`);
    return false;
  }

  const url = `${REST_BASE}/fapi/v1/aggTrades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`;
  try {
    const res = await fetch(url);

    if (res.status === 418 || res.status === 429) {
      const retryAfter =
        Number(res.headers.get("Retry-After") ?? "0") || undefined;
      applyRestBan(retryAfter);
      return false;
    }

    if (!res.ok) {
      console.warn(`[aggTradeWs] Bootstrap REST ${res.status} for ${symbol}`);
      return false;
    }

    const data = await res.json();
    if (!Array.isArray(data)) return false;

    const valid = (data as BinanceAggTrade[]).filter(
      (t) =>
        t &&
        typeof t.T === "number" &&
        typeof t.q === "string" &&
        typeof t.p === "string",
    );

    if (valid.length === 0) return false;

    const state = getOrCreate(symbol);
    // Merge: prepend REST trades then deduplicate by timestamp, then prune
    // WS may have already received some of these — keep unique by T+m combination
    const existingSet = new Set(
      state.buffer.map((t) => `${t.T}_${t.m}_${t.q}`),
    );
    const newTrades = valid.filter(
      (t) => !existingSet.has(`${t.T}_${t.m}_${t.q}`),
    );
    state.buffer.unshift(...newTrades);
    state.buffer.sort((a, b) => a.T - b.T);
    pruneBuffer(state);
    notifySubscribers(state);

    return true;
  } catch (err) {
    console.warn(`[aggTradeWs] Bootstrap fetch error for ${symbol}:`, err);
    return false;
  }
}

/**
 * Whether the REST endpoint is currently banned (418 / 429).
 */
export function isAggRestBanned(): boolean {
  return isRestBanned();
}

/**
 * Remaining ban time in milliseconds (0 if not banned).
 */
export function restBanRemainingMs(): number {
  return Math.max(0, restBannedUntil - Date.now());
}
