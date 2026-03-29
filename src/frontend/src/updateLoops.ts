import {
  fetchAllTickers,
  fetchExchangeInfo,
  fetchKlines,
  fetchKlinesBatch,
  parseKlines,
} from "./binanceApi";
import { TTL, getCache, setCache } from "./cache";
import {
  assignPhase,
  computeBreakoutScore,
  computePressure,
  computeTension,
  computeVacuumSide,
} from "./scoringEngine";
import { useHealthStore } from "./stores/healthStore";
import { validateSymbols } from "./symbolValidator";
import { selectTop10 } from "./top10Engine";
import type { AppStatus, Candidate, LivePatch } from "./types";

const DISCOVERY_INTERVAL_MS = 90_000;
const LIVE_INTERVAL_MS = 5_000;
const MAX_SCAN_SYMBOLS = 150;

const RETRY_DELAYS = [2000, 5000, 10000];

async function withBackoff<T>(
  fn: () => Promise<T | null>,
  label: string,
): Promise<T | null> {
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS[attempt - 1];
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      const result = await fn();
      if (result !== null) return result;
    } catch (err) {
      console.warn(`[${label}] attempt ${attempt + 1} failed:`, err);
      useHealthStore.getState().incrementFailedRequests();
      useHealthStore
        .getState()
        .setLastError(
          `${label}: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
  }
  return null;
}

export function startDiscoveryLoop(
  onComplete: (candidates: Candidate[]) => void,
  onStatusChange: (status: AppStatus) => void,
): () => void {
  let cancelled = false;
  let inFlight = false;

  async function runScan(): Promise<void> {
    if (cancelled || inFlight) return;
    inFlight = true;
    useHealthStore.getState().setInFlightScan(true);
    onStatusChange("SCANNING");

    const hasCachedFallback = !!getCache<Candidate[]>("top10Snapshot");

    try {
      // 1. Valid symbols
      let validSymbols = getCache<string[]>("universe");
      if (!validSymbols) {
        const info = await withBackoff(fetchExchangeInfo, "fetchExchangeInfo");
        if (cancelled) {
          inFlight = false;
          useHealthStore.getState().setInFlightScan(false);
          return;
        }
        if (!info) {
          if (!hasCachedFallback) onStatusChange("ERROR");
          else onStatusChange("STALE");
          inFlight = false;
          useHealthStore.getState().setInFlightScan(false);
          return;
        }
        validSymbols = validateSymbols(info);
        setCache("universe", validSymbols, TTL.universe);
      }

      // 2. All tickers
      const allTickers = await withBackoff(fetchAllTickers, "fetchAllTickers");
      if (cancelled) {
        inFlight = false;
        useHealthStore.getState().setInFlightScan(false);
        return;
      }
      if (!allTickers) {
        if (!hasCachedFallback) onStatusChange("ERROR");
        else onStatusChange("STALE");
        inFlight = false;
        useHealthStore.getState().setInFlightScan(false);
        return;
      }

      const validSet = new Set(validSymbols);
      const filteredTickers = allTickers.filter((t) => validSet.has(t.symbol));
      const sortedByVolume = [...filteredTickers]
        .sort(
          (a, b) =>
            Number.parseFloat(b.quoteVolume) - Number.parseFloat(a.quoteVolume),
        )
        .slice(0, MAX_SCAN_SYMBOLS);
      const symbolsToScan = sortedByVolume.map((t) => t.symbol);

      // 3. Klines batch
      const klinesMap = await fetchKlinesBatch(symbolsToScan, "1m", 50, 20);
      if (cancelled) {
        inFlight = false;
        useHealthStore.getState().setInFlightScan(false);
        return;
      }

      // 4. Score — per-symbol safety
      const candidates: Omit<Candidate, "rank">[] = [];
      for (const ticker of sortedByVolume) {
        try {
          const klines = klinesMap.get(ticker.symbol);
          if (!klines || klines.length < 10) continue;

          const pct = Number.parseFloat(ticker.priceChangePercent);
          const tension = computeTension(klines);
          const pressure = computePressure(pct);
          const breakoutScore = computeBreakoutScore(tension, pressure, klines);
          const phase = assignPhase(tension, pressure, breakoutScore, klines);
          const price = Number.parseFloat(ticker.lastPrice);
          const vacuumSide = computeVacuumSide(klines, price);

          candidates.push({
            symbol: ticker.symbol,
            price,
            priceChangePercent: pct,
            tension,
            pressure,
            breakoutScore,
            phase,
            vacuumSide,
          });
        } catch (symErr) {
          console.warn(`[scan] skipping ${ticker.symbol}:`, symErr);
        }
      }

      const top10 = selectTop10(candidates);

      if (top10.length === 0) {
        if (!hasCachedFallback) onStatusChange("ERROR");
        else onStatusChange("STALE");
        inFlight = false;
        useHealthStore.getState().setInFlightScan(false);
        return;
      }

      setCache("top10Snapshot", top10, TTL.top10Snapshot);
      useHealthStore.getState().setLastFullScanTime(Date.now());

      if (!cancelled) {
        onComplete(top10);
        onStatusChange("LIVE");
      }
    } catch (err) {
      console.error("[discovery loop] unexpected error:", err);
      useHealthStore.getState().incrementFailedRequests();
      useHealthStore
        .getState()
        .setLastError(
          `discovery: ${err instanceof Error ? err.message : String(err)}`,
        );
      if (!cancelled) {
        if (!hasCachedFallback) onStatusChange("ERROR");
        else onStatusChange("STALE");
      }
    } finally {
      inFlight = false;
      useHealthStore.getState().setInFlightScan(false);
    }
  }

  runScan();
  const interval = setInterval(() => {
    if (!cancelled) runScan();
  }, DISCOVERY_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(interval);
  };
}

export function startTop10LiveLoop(
  getSymbols: () => string[],
  onPatch: (patches: Record<string, LivePatch>) => void,
): () => void {
  let cancelled = false;
  let inFlight = false;

  async function runLive(): Promise<void> {
    if (cancelled || inFlight) return;
    inFlight = true;

    try {
      const symbols = getSymbols();
      if (symbols.length === 0) return;

      const allTickers = await fetchAllTickers();
      if (cancelled || !allTickers) return;

      const symbolSet = new Set(symbols);
      const tickers = allTickers.filter((t) => symbolSet.has(t.symbol));

      const patches: Record<string, LivePatch> = {};
      const now = Date.now();

      const klinesResults = await Promise.all(
        tickers.map(async (t) => {
          try {
            const raw = await fetchKlines(t.symbol, "1m", 20);
            return { symbol: t.symbol, klines: raw ? parseKlines(raw) : null };
          } catch {
            return { symbol: t.symbol, klines: null };
          }
        }),
      );

      for (const { symbol, klines } of klinesResults) {
        try {
          const ticker = tickers.find((t) => t.symbol === symbol);
          if (!ticker) continue;

          const pct = Number.parseFloat(ticker.priceChangePercent);
          const price = Number.parseFloat(ticker.lastPrice);
          const pressure = computePressure(pct);

          let tension = 50;
          let vacuumSide: LivePatch["vacuumSide"] = undefined;

          if (klines && klines.length >= 10) {
            tension = computeTension(klines);
            vacuumSide = computeVacuumSide(klines, price);
          }

          const breakoutScore = computeBreakoutScore(
            tension,
            pressure,
            klines ?? [],
          );
          const phase = klines
            ? assignPhase(tension, pressure, breakoutScore, klines)
            : undefined;

          patches[symbol] = {
            price,
            priceChangePercent: pct,
            tension,
            pressure,
            breakoutScore,
            phase,
            vacuumSide,
            lastUpdateTime: now,
            isStale: false,
          };
        } catch (symErr) {
          console.warn(`[live loop] skipping ${symbol}:`, symErr);
        }
      }

      if (!cancelled && Object.keys(patches).length > 0) {
        onPatch(patches);
      }
    } catch (err) {
      console.warn("[live loop] error:", err);
      useHealthStore.getState().incrementFailedRequests();
    } finally {
      inFlight = false;
    }
  }

  const interval = setInterval(() => {
    if (!cancelled) runLive();
  }, LIVE_INTERVAL_MS);

  return () => {
    cancelled = true;
    clearInterval(interval);
  };
}
