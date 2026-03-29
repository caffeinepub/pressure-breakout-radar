/**
 * runtimeCore.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Central runtime state manager for Pressure Breakout Radar.
 *
 * Handles background freeze / resume cycle:
 *   - On visibilitychange → hidden: persist full snapshot + chart state
 *   - On visibilitychange → visible: restore instantly, notify listeners
 *
 * SelectedMonitor subscribes to resume events and restores immediately
 * before the first live tick completes.
 */

import { getCache } from "./cache";
import type { SelectedMonitorSnapshot } from "./types";

// ── Runtime modes ──────────────────────────────────────────────────────────
export type RuntimeMode = "LIVE" | "FROZEN" | "CATCH_UP" | "STALE" | "ERROR";

// ── Frozen snapshot max age ─────────────────────────────────────────────────
const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

// ── Chart view state (persisted alongside snapshot) ─────────────────────────
export interface ChartViewState {
  paddingMode: string;
  timeframe: "1m" | "5m" | "15m";
}

// ── Internal state ───────────────────────────────────────────────────────────
let activeSymbol: string | null = null;
let activeTimeframe: "1m" | "5m" | "15m" = "1m";
let activeChartState: ChartViewState = {
  paddingMode: "standard",
  timeframe: "1m",
};
let currentMode: RuntimeMode = "LIVE";
let initialized = false;

// ── Callback registries ──────────────────────────────────────────────────────
type OnResumeFn = (
  snapshot: SelectedMonitorSnapshot | null,
  chartState: ChartViewState | null,
) => void;
type OnModeFn = (mode: RuntimeMode) => void;

const resumeListeners = new Set<OnResumeFn>();
const modeListeners = new Set<OnModeFn>();

// ── Public API ───────────────────────────────────────────────────────────────

export function getRuntimeMode(): RuntimeMode {
  return currentMode;
}

export function setRuntimeMode(mode: RuntimeMode): void {
  currentMode = mode;
  for (const cb of modeListeners) {
    try {
      cb(mode);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Called by SelectedMonitor whenever symbol, timeframe, or chart state
 * changes so the core knows what to persist on freeze.
 */
export function updateActiveMonitor(
  symbol: string,
  timeframe: "1m" | "5m" | "15m",
  chartState: ChartViewState,
): void {
  activeSymbol = symbol;
  activeTimeframe = timeframe;
  activeChartState = chartState;
}

/**
 * Called by SelectedMonitor when it unmounts (symbol deselected).
 */
export function clearActiveMonitor(): void {
  activeSymbol = null;
}

/** Subscribe to runtime mode changes. Returns unsubscribe fn. */
export function subscribeRuntimeMode(cb: OnModeFn): () => void {
  modeListeners.add(cb);
  return () => modeListeners.delete(cb);
}

/**
 * Subscribe to resume events (app returning to foreground).
 * Callback fires immediately after restore with the frozen snapshot.
 * Returns unsubscribe fn.
 */
export function subscribeResume(cb: OnResumeFn): () => void {
  resumeListeners.add(cb);
  return () => resumeListeners.delete(cb);
}

// ── Persistence helpers ───────────────────────────────────────────────────────

export function loadFrozenSnapshot(
  symbol: string,
  timeframe: string,
): SelectedMonitorSnapshot | null {
  try {
    const raw = localStorage.getItem(`pbr_monitor_${symbol}_${timeframe}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      data: SelectedMonitorSnapshot;
      ts: number;
    };
    if (Date.now() - parsed.ts > SNAPSHOT_MAX_AGE_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function loadFrozenChartState(
  symbol: string,
  timeframe: string,
): ChartViewState | null {
  try {
    const raw = localStorage.getItem(`pbr_chart_${symbol}_${timeframe}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: ChartViewState; ts: number };
    if (Date.now() - parsed.ts > SNAPSHOT_MAX_AGE_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function persistSnapshot(): void {
  if (!activeSymbol) return;

  // Prefer the in-memory cache entry (most recent tick)
  const snapshot = getCache<SelectedMonitorSnapshot>(
    `monitor_${activeSymbol}_${activeTimeframe}`,
  );

  if (snapshot) {
    try {
      localStorage.setItem(
        `pbr_monitor_${activeSymbol}_${activeTimeframe}`,
        JSON.stringify({ data: snapshot, ts: Date.now() }),
      );
    } catch {
      // localStorage full — silently ignore
    }
  }

  try {
    localStorage.setItem(
      `pbr_chart_${activeSymbol}_${activeTimeframe}`,
      JSON.stringify({ data: activeChartState, ts: Date.now() }),
    );
  } catch {
    // ignore
  }
}

// ── Visibility change handlers ────────────────────────────────────────────────

function handleHidden(): void {
  persistSnapshot();
  setRuntimeMode("FROZEN");
}

function handleVisible(): void {
  // Only trigger resume flow when coming back from FROZEN
  if (currentMode !== "FROZEN") return;

  setRuntimeMode("CATCH_UP");

  const snapshot = activeSymbol
    ? loadFrozenSnapshot(activeSymbol, activeTimeframe)
    : null;

  const chartState = activeSymbol
    ? loadFrozenChartState(activeSymbol, activeTimeframe)
    : null;

  for (const cb of resumeListeners) {
    try {
      cb(snapshot, chartState);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Must be called once at app startup (e.g., in App.tsx useEffect).
 * Safe to call multiple times — idempotent.
 */
export function initRuntimeCore(): void {
  if (initialized) return;
  initialized = true;

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      handleHidden();
    } else {
      handleVisible();
    }
  });
}
