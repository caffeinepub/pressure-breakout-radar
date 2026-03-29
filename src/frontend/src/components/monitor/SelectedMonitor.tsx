import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { getCache } from "../../cache";
import { performCatchUp, startMonitorLoop } from "../../loops/monitorLoop";
import {
  type RuntimeMode,
  clearActiveMonitor,
  getRuntimeMode,
  loadFrozenChartState,
  loadFrozenSnapshot,
  setRuntimeMode,
  subscribeResume,
  subscribeRuntimeMode,
  updateActiveMonitor,
} from "../../runtimeCore";
import { useSelectedMonitorStore } from "../../stores/selectedMonitorStore";
import { useUIStore } from "../../stores/uiStore";
import type {
  AggressionBubble,
  ExecutionContext,
  SelectedMonitorSnapshot,
} from "../../types";
import { AlignmentStatusStrip } from "./AlignmentStatusStrip";
import { BreakoutContextBlock } from "./BreakoutContextBlock";
import { CandlestickChart } from "./CandlestickChart";
import { ExecutionContextBlock } from "./ExecutionContextBlock";
import { MonitorHeader } from "./MonitorHeader";
import { PressureBlock } from "./PressureBlock";
import { TensionBlock } from "./TensionBlock";

interface SelectedMonitorProps {
  symbol: string;
}

type PaddingMode = "compact" | "standard" | "wide";
type Timeframe = "1m" | "5m" | "15m";

function fmtTs(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function SelectedMonitor({ symbol }: SelectedMonitorProps) {
  const setSelectedSymbol = useUIStore((s) => s.setSelectedSymbol);
  const snapshot = useSelectedMonitorStore((s) => s.snapshot);
  const setSnapshot = useSelectedMonitorStore((s) => s.setSnapshot);
  const patchSnapshot = useSelectedMonitorStore((s) => s.patchSnapshot);
  const clearSnapshot = useSelectedMonitorStore((s) => s.clearSnapshot);
  const [paddingMode, setPaddingMode] = useState<PaddingMode>("standard");
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [debugOpen, setDebugOpen] = useState(false);
  const loopCleanupRef = useRef<(() => void) | null>(null);

  // ── RUNTIME MODE STATE ───────────────────────────────────────────────────
  const [runtimeMode, setLocalRuntimeMode] = useState<RuntimeMode>(() =>
    getRuntimeMode(),
  );

  // ── STABLE OVERLAY STATE ─────────────────────────────────────────────────
  const [stableExecCtx, setStableExecCtx] = useState<ExecutionContext | null>(
    null,
  );
  const [stableBubbles, setStableBubbles] = useState<AggressionBubble[]>([]);
  const [execOverlayTs, setExecOverlayTs] = useState<number>(0);

  // ── Sync runtime mode from core ────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribeRuntimeMode((mode) => {
      setLocalRuntimeMode(mode);
    });
    return unsub;
  }, []);

  // ── Subscribe to resume events from runtimeCore ───────────────────────────
  useEffect(() => {
    const unsub = subscribeResume((frozenSnapshot, frozenChartState) => {
      // 1. Restore snapshot immediately — no blank screen
      if (frozenSnapshot) {
        setSnapshot({ ...frozenSnapshot, status: "REFRESHING" });
        // Restore stable overlays from snapshot
        if (frozenSnapshot.executionContext) {
          setStableExecCtx(frozenSnapshot.executionContext);
          setExecOverlayTs(frozenSnapshot.lastSuccessTime ?? 0);
        }
        if (
          frozenSnapshot.aggressionBubbles &&
          frozenSnapshot.aggressionBubbles.length > 0
        ) {
          setStableBubbles(frozenSnapshot.aggressionBubbles);
        }
      }

      // 2. Restore chart view state if available
      if (frozenChartState) {
        if (frozenChartState.paddingMode) {
          setPaddingMode(frozenChartState.paddingMode as PaddingMode);
        }
        // Timeframe is already correct (symbol+timeframe are preserved)
      }

      // 3. Trigger catch-up using the last known success timestamp
      const lastTs = frozenSnapshot?.lastSuccessTime ?? 0;
      const gapMs = Date.now() - lastTs;
      const CATCH_UP_THRESHOLD_MS = 30_000;

      if (lastTs > 0 && gapMs > CATCH_UP_THRESHOLD_MS) {
        // Perform catch-up fetch to fill the gap
        performCatchUp(
          symbol,
          timeframe,
          lastTs,
          (update) => {
            const isFullSnapshot =
              "candles" in update &&
              "symbol" in update &&
              "lastSuccessTime" in update;
            if (isFullSnapshot) {
              setSnapshot(update as SelectedMonitorSnapshot);
            } else {
              patchSnapshot(update);
            }
          },
          (status) => {
            patchSnapshot({ status });
          },
        );
      } else {
        // Gap is small — normal loop will catch up on next tick
        setRuntimeMode("LIVE");
      }
    });
    return unsub;
  }, [symbol, timeframe, setSnapshot, patchSnapshot]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: stable zustand actions, symbol/timeframe-keyed setup
  useEffect(() => {
    // Reset on symbol/timeframe change — strict isolation
    setStableExecCtx(null);
    setStableBubbles([]);
    setExecOverlayTs(0);

    // Try frozen localStorage snapshot first (covers page reload after background)
    const frozen = loadFrozenSnapshot(symbol, timeframe);
    const frozenChart = loadFrozenChartState(symbol, timeframe);

    const cached = getCache<SelectedMonitorSnapshot>(
      `monitor_${symbol}_${timeframe}`,
    );

    // Use whichever snapshot is fresher
    const restoreFrom =
      frozen &&
      (!cached || frozen.lastSuccessTime > (cached.lastSuccessTime ?? 0))
        ? frozen
        : cached;

    if (restoreFrom) {
      setSnapshot({ ...restoreFrom, status: "REFRESHING" });
      if (restoreFrom.executionContext) {
        setStableExecCtx(restoreFrom.executionContext);
        setExecOverlayTs(restoreFrom.lastSuccessTime ?? 0);
      }
      if (
        restoreFrom.aggressionBubbles &&
        restoreFrom.aggressionBubbles.length > 0
      ) {
        setStableBubbles(restoreFrom.aggressionBubbles);
      }
    } else {
      clearSnapshot();
    }

    // Restore chart view from frozen state
    if (frozenChart?.paddingMode) {
      setPaddingMode(frozenChart.paddingMode as PaddingMode);
    }

    // Register this monitor as active in runtimeCore
    updateActiveMonitor(symbol, timeframe, {
      paddingMode,
      timeframe,
    });

    const cleanup = startMonitorLoop(
      symbol,
      timeframe,
      (update) => {
        const isFullSnapshot =
          "candles" in update &&
          "symbol" in update &&
          "lastSuccessTime" in update;
        if (isFullSnapshot) {
          setSnapshot(update as SelectedMonitorSnapshot);
        } else {
          patchSnapshot(update);
        }
        if (update.executionContext) {
          setStableExecCtx(update.executionContext);
          setExecOverlayTs(Date.now());
        }
        if (update.aggressionBubbles && update.aggressionBubbles.length > 0) {
          setStableBubbles(update.aggressionBubbles);
        }
      },
      (status) => {
        patchSnapshot({ status });
      },
    );

    loopCleanupRef.current = cleanup;

    return () => {
      loopCleanupRef.current?.();
      clearActiveMonitor();
    };
  }, [symbol, timeframe]);

  // ── Keep runtimeCore in sync with current chart view state ────────────────
  useEffect(() => {
    updateActiveMonitor(symbol, timeframe, { paddingMode, timeframe });
  }, [symbol, timeframe, paddingMode]);

  const handleClose = () => setSelectedSymbol(null);
  const dbg = snapshot?.bubbleDebug;
  const diag = snapshot?.bubbleFetchDiagnostics;
  const loopStatus = snapshot?.bubbleLoopStatus;

  const visibleOnChart = stableBubbles.length;
  const visibleGreenOnChart = stableBubbles.filter(
    (b) => b.side === "BUY",
  ).length;
  const visibleRedOnChart = stableBubbles.filter(
    (b) => b.side === "SELL",
  ).length;

  // Runtime mode badge
  const showModeBadge =
    runtimeMode === "CATCH_UP" ||
    runtimeMode === "FROZEN" ||
    runtimeMode === "STALE";
  const modeBadgeLabel =
    runtimeMode === "CATCH_UP"
      ? "CATCHING UP"
      : runtimeMode === "FROZEN"
        ? "FROZEN"
        : "STALE";
  const modeBadgeColor =
    runtimeMode === "CATCH_UP"
      ? "oklch(0.75 0.18 55)"
      : runtimeMode === "STALE"
        ? "oklch(0.65 0.20 25)"
        : "oklch(0.55 0.05 200)";

  const pillSummary = (() => {
    if (loopStatus === "RETRYING")
      return ` ▼ RETRY ${snapshot?.bubbleRetryCount ?? "?"}/${RETRY_DELAYS_COUNT} | CHART:${visibleOnChart}`;
    if (loopStatus === "STALE") return ` ▼ STALE | CHART:${visibleOnChart}`;
    if (loopStatus === "NO_EVENTS")
      return ` ▼ NO EVENTS | CHART:${visibleOnChart}`;
    if (loopStatus === "FETCHING")
      return ` ▼ FETCHING | CHART:${visibleOnChart}`;
    if (dbg)
      return ` ▼ EV:${dbg.eventsDetected} G:${dbg.greenBubbles} R:${dbg.redBubbles} | CHART:${visibleOnChart}`;
    return ` ▼ BOOTSTRAPPING | CHART:${visibleOnChart}`;
  })();

  const dotColor =
    visibleOnChart > 0
      ? "oklch(0.72 0.17 145)"
      : loopStatus === "STALE"
        ? "oklch(0.65 0.20 25)"
        : "oklch(0.45 0.05 200)";

  const failureTypeColor = (ft: string | undefined): string => {
    if (!ft) return "oklch(0.55 0.05 200)";
    if (ft === "ABORT_ERROR") return "oklch(0.75 0.18 55)";
    if (ft === "NETWORK_ERROR") return "oklch(0.65 0.20 25)";
    if (ft === "HTTP_ERROR") return "oklch(0.65 0.20 25)";
    if (ft === "PARSE_ERROR") return "oklch(0.75 0.18 55)";
    if (ft === "EMPTY_RESPONSE") return "oklch(0.65 0.10 195)";
    return "oklch(0.55 0.05 200)";
  };

  return (
    <AnimatePresence>
      <motion.div
        key={symbol}
        data-ocid="monitor.panel"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="fixed inset-0 z-50 flex flex-col"
        style={{
          backgroundImage:
            "linear-gradient(160deg, oklch(0.11 0.025 200) 0%, oklch(0.08 0.02 210) 100%)",
        }}
      >
        {/* Subtle grid overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(50,120,130,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(50,120,130,0.06) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        <div
          className="relative z-10 flex flex-col flex-1 overflow-y-auto"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {/* Header */}
          <div className="px-4 pt-3 pb-2">
            {snapshot ? (
              <MonitorHeader snapshot={snapshot} onClose={handleClose} />
            ) : (
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  data-ocid="monitor.close_button"
                  onClick={handleClose}
                  className="flex items-center gap-1.5 text-radar-dim hover:text-foreground transition-colors text-[12px] font-mono"
                >
                  <span className="text-base leading-none">←</span>
                  <span>BACK</span>
                </button>
                <div className="flex items-center gap-2">
                  <span className="live-dot-cyan" />
                  <span className="text-[11px] font-mono text-radar-cyan scan-blink">
                    LOADING...
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Runtime mode badge — CATCH_UP / FROZEN / STALE */}
          {showModeBadge && (
            <div className="px-4 pb-1">
              <div
                className="flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[9px] font-mono tracking-wider w-fit"
                style={{
                  color: modeBadgeColor,
                  border: `1px solid ${modeBadgeColor}40`,
                  background: `${modeBadgeColor}15`,
                }}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: modeBadgeColor }}
                />
                {modeBadgeLabel}
                {runtimeMode === "CATCH_UP" && (
                  <span className="opacity-60 ml-1">filling gap…</span>
                )}
              </div>
            </div>
          )}

          <div className="border-t border-[oklch(0.78_0.13_195/8%)]" />

          {/* Alignment Status Strip */}
          <div className="px-4 mt-1.5">
            <AlignmentStatusStrip
              breakoutBias={snapshot?.breakoutContext?.bias}
              pressureSide={snapshot?.pressure?.side}
            />
          </div>

          {/* Chart area — locked at 420px */}
          <div
            data-ocid="monitor.canvas_target"
            className="card-glow bg-card mx-4 mt-2 rounded-2xl overflow-hidden"
            style={{ minHeight: 420 }}
          >
            {/* Timeframe switcher */}
            <div className="flex items-center gap-1 px-3 pt-2 pb-0.5">
              {(["1m", "5m", "15m"] as const).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  data-ocid={`monitor.${tf}.tab`}
                  onClick={() => setTimeframe(tf)}
                  className={`px-2.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider transition-all ${
                    timeframe === tf
                      ? "bg-[oklch(0.78_0.13_195/22%)] text-radar-cyan border border-[oklch(0.78_0.13_195/35%)]"
                      : "text-radar-dim border border-transparent hover:text-foreground"
                  }`}
                >
                  {tf}
                </button>
              ))}
              <span className="ml-auto text-[9px] font-mono text-radar-dim opacity-60">
                {timeframe === "1m"
                  ? "MICRO"
                  : timeframe === "5m"
                    ? "STRUCTURE"
                    : "BREAKOUT"}
              </span>
            </div>

            <CandlestickChart
              candles={snapshot?.candles ?? []}
              currentPrice={snapshot?.price ?? 0}
              paddingMode={paddingMode}
              height={420}
              aggressionBubbles={stableBubbles}
              vacuumZone={snapshot?.vacuumZone}
              timeframe={timeframe}
              executionContext={stableExecCtx ?? undefined}
            />
          </div>

          {/* Execution Context */}
          <div className="px-4 mt-2">
            <ExecutionContextBlock ctx={stableExecCtx} />
          </div>

          {/* ── BUBBLE DEBUG PILL (collapsible) ── */}
          <div className="px-4 mt-1.5">
            <button
              type="button"
              onClick={() => setDebugOpen((o) => !o)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[oklch(0.78_0.13_195/20%)] bg-[oklch(0.10_0.02_210/80%)] text-[9px] font-mono text-radar-dim hover:text-radar-cyan hover:border-[oklch(0.78_0.13_195/40%)] transition-all w-full"
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: dotColor }}
              />
              <span className="truncate">AGG BUBBLES{pillSummary}</span>
              <span className="ml-auto opacity-50 flex-shrink-0">
                {debugOpen ? "▲" : "▼"}
              </span>
            </button>

            {debugOpen && (
              <div className="mt-1 px-3 py-2.5 rounded-xl border border-[oklch(0.78_0.13_195/15%)] bg-[oklch(0.08_0.02_210/90%)] font-mono text-[9px] leading-relaxed space-y-2">
                {/* Chart Draw Layer */}
                <div>
                  <div className="text-[8px] text-radar-dim/50 uppercase tracking-wider mb-1">
                    Chart Draw Layer
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                    <span className="text-radar-dim">Visible on chart</span>
                    <span
                      style={{
                        color:
                          visibleOnChart > 0
                            ? "oklch(0.72 0.17 145)"
                            : "oklch(0.65 0.20 25)",
                        fontWeight: 700,
                      }}
                    >
                      {visibleOnChart}{" "}
                      {visibleOnChart > 0
                        ? `(G:${visibleGreenOnChart} R:${visibleRedOnChart})`
                        : "— NOT DRAWN"}
                    </span>
                  </div>
                </div>

                {/* Loop State */}
                <div>
                  <div className="text-[8px] text-radar-dim/50 uppercase tracking-wider mb-1">
                    Loop State
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                    <span className="text-radar-dim">Status</span>
                    <span
                      style={{
                        color:
                          loopStatus === "LIVE" || loopStatus === "WS_LIVE"
                            ? "oklch(0.72 0.17 145)"
                            : loopStatus === "RETRYING"
                              ? "oklch(0.75 0.18 55)"
                              : loopStatus === "STALE"
                                ? "oklch(0.65 0.20 25)"
                                : loopStatus === "NO_EVENTS"
                                  ? "oklch(0.65 0.10 195)"
                                  : loopStatus === "WS_CONNECTING" ||
                                      loopStatus === "WS_RECONNECTING"
                                    ? "oklch(0.75 0.15 55)"
                                    : "oklch(0.55 0.05 200)",
                        fontWeight: 700,
                      }}
                    >
                      {loopStatus ?? "BOOTSTRAPPING"}
                      {loopStatus === "RETRYING" &&
                        ` ${snapshot?.bubbleRetryCount ?? "?"}/${RETRY_DELAYS_COUNT}`}
                    </span>

                    <span className="text-radar-dim">Cause</span>
                    <span className="text-foreground">
                      {snapshot?.bubbleLastFetchCause ?? "—"}
                    </span>

                    <span className="text-radar-dim">Runtime mode</span>
                    <span
                      style={{
                        color: modeBadgeColor,
                        fontWeight: runtimeMode !== "LIVE" ? 700 : undefined,
                      }}
                    >
                      {runtimeMode}
                    </span>
                  </div>
                </div>

                {/* Last Successful Fetch */}
                <div>
                  <div className="text-[8px] text-radar-dim/50 uppercase tracking-wider mb-1">
                    Last Successful Fetch
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                    <span className="text-radar-dim">Timestamp</span>
                    <span className="text-foreground">
                      {fmtTs(diag?.lastSuccessTs ?? 0)}
                    </span>

                    <span className="text-radar-dim">Bubble count</span>
                    <span className="text-foreground">
                      {diag?.lastSuccessBubbleCount ?? "—"}
                    </span>
                  </div>
                </div>

                {/* Detection Stats */}
                {dbg && (
                  <div>
                    <div className="text-[8px] text-radar-dim/50 uppercase tracking-wider mb-1">
                      Detection Stats
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      <span className="text-radar-dim">Events detected</span>
                      <span className="text-foreground">
                        {dbg.eventsDetected}
                      </span>

                      <span className="text-radar-dim">Green (BUY)</span>
                      <span style={{ color: "oklch(0.72 0.17 145)" }}>
                        {dbg.greenBubbles}
                      </span>

                      <span className="text-radar-dim">Red (SELL)</span>
                      <span style={{ color: "oklch(0.65 0.20 25)" }}>
                        {dbg.redBubbles}
                      </span>

                      <span className="text-radar-dim">Avg radius</span>
                      <span className="text-foreground">{dbg.avgRadius}px</span>

                      <span className="text-radar-dim">Max strength</span>
                      <span className="text-foreground">{dbg.maxStrength}</span>

                      <span className="text-radar-dim">Dir threshold</span>
                      <span className="text-radar-cyan">
                        {Math.round(dbg.dirThreshold * 100)}%
                      </span>

                      <span className="text-radar-dim">Vol floor</span>
                      <span className="text-radar-cyan">
                        {Math.round(dbg.volFloor * 100)}%
                      </span>
                    </div>
                  </div>
                )}

                {/* Fetch Diagnostics */}
                {diag?.failureType && (
                  <div>
                    <div className="text-[8px] text-radar-dim/50 uppercase tracking-wider mb-1">
                      Fetch Diagnostics
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      <span className="text-radar-dim">Failure type</span>
                      <span
                        style={{
                          color: failureTypeColor(diag.failureType),
                          fontWeight: 700,
                        }}
                      >
                        {diag.failureType}
                      </span>

                      {diag.errorName && (
                        <>
                          <span className="text-radar-dim">Error name</span>
                          <span className="text-foreground">
                            {diag.errorName}
                          </span>
                        </>
                      )}

                      {diag.errorMessage && (
                        <>
                          <span className="text-radar-dim">Error msg</span>
                          <span
                            className="text-foreground col-span-1 break-all"
                            style={{ wordBreak: "break-all" }}
                          >
                            {diag.errorMessage.slice(0, 80)}
                          </span>
                        </>
                      )}

                      {diag.httpStatus !== undefined && (
                        <>
                          <span className="text-radar-dim">HTTP status</span>
                          <span
                            style={{
                              color: "oklch(0.65 0.20 25)",
                              fontWeight: 700,
                            }}
                          >
                            {diag.httpStatus}
                          </span>
                        </>
                      )}

                      {diag.requestUrl && (
                        <>
                          <span className="text-radar-dim">Endpoint</span>
                          <span
                            className="text-foreground break-all"
                            style={{ wordBreak: "break-all", fontSize: "8px" }}
                          >
                            {diag.requestUrl
                              .replace("https://fapi.binance.com", "")
                              .slice(0, 60)}
                          </span>
                        </>
                      )}

                      <span className="text-radar-dim">Symbol</span>
                      <span className="text-radar-cyan">{diag.symbol}</span>

                      <span className="text-radar-dim">Timeframe</span>
                      <span className="text-radar-cyan">{diag.timeframe}</span>
                    </div>
                  </div>
                )}

                {loopStatus === "RETRYING" && (
                  <div className="text-[8px] text-radar-dim/60 pt-0.5 border-t border-[oklch(0.78_0.13_195/10%)]">
                    Last-known-good bubbles preserved — retrying before STALE.
                    CHART:{visibleOnChart} shows whether preserved set is drawn.
                  </div>
                )}
                {loopStatus === "STALE" && (
                  <div className="text-[8px] text-radar-dim/60 pt-0.5 border-t border-[oklch(0.78_0.13_195/10%)]">
                    3 retries exhausted. TTL expired with no valid replacement.
                  </div>
                )}
                {loopStatus === "NO_EVENTS" && (
                  <div className="text-[8px] text-radar-dim/60 pt-0.5 border-t border-[oklch(0.78_0.13_195/10%)]">
                    Fetch succeeded — no bucket exceeded aggression threshold
                    this window.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Exec overlay debug row */}
          {execOverlayTs > 0 && (
            <div className="px-4 mt-0.5">
              <div className="flex items-center gap-2 px-2.5 py-0.5 text-[8px] font-mono text-radar-dim/60">
                <span
                  className="inline-block w-1 h-1 rounded-full"
                  style={{
                    background: stableExecCtx?.hasCleanEntry
                      ? "oklch(0.72 0.17 145 / 0.7)"
                      : "oklch(0.45 0.05 200)",
                  }}
                />
                <span>EXEC OVERLAY</span>
                <span className="text-radar-dim/40">·</span>
                <span>
                  age: {Math.round((Date.now() - execOverlayTs) / 1000)}s
                </span>
                <span className="text-radar-dim/40">·</span>
                <span>{stableExecCtx?.entryBias ?? "—"}</span>
                <span className="text-radar-dim/40">·</span>
                <span>{stableExecCtx?.executionQuality ?? "—"}</span>
                {stableExecCtx?.rMultiple ? (
                  <>
                    <span className="text-radar-dim/40">·</span>
                    <span>{stableExecCtx.rMultiple.toFixed(1)}R</span>
                  </>
                ) : null}
              </div>
            </div>
          )}

          {/* Padding mode toggle */}
          <div className="flex items-center gap-1 px-4 mt-1.5 justify-end">
            <span className="text-[9px] font-mono text-radar-dim mr-1 uppercase tracking-wider">
              PADDING
            </span>
            {(["compact", "standard", "wide"] as PaddingMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                data-ocid={`monitor.${mode}.toggle`}
                onClick={() => setPaddingMode(mode)}
                className={`px-2 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider transition-colors ${
                  paddingMode === mode
                    ? "bg-[oklch(0.78_0.13_195/20%)] text-radar-cyan border border-[oklch(0.78_0.13_195/30%)]"
                    : "text-radar-dim border border-transparent hover:text-foreground"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Tension + Pressure grid */}
          <div className="grid grid-cols-2 gap-3 px-4 mt-2">
            <TensionBlock
              tension={snapshot?.tension ?? null}
              trend={snapshot?.tensionTrend ?? null}
            />
            <PressureBlock
              pressure={snapshot?.pressure ?? null}
              trend={snapshot?.pressureTrend ?? null}
            />
          </div>

          {/* Breakout Context */}
          <div className="px-4 mt-2">
            <BreakoutContextBlock ctx={snapshot?.breakoutContext ?? null} />
          </div>

          {/* Status / last update */}
          {snapshot && (
            <div className="px-4 mt-2 pb-1">
              <div className="text-[9px] font-mono text-radar-dim text-right">
                Last update:{" "}
                {new Date(snapshot.lastSuccessTime).toLocaleTimeString(
                  "en-US",
                  {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                  },
                )}
              </div>
            </div>
          )}

          {/* Bottom safe-area spacer */}
          <div
            style={{
              paddingBottom: "env(safe-area-inset-bottom, 16px)",
              height: "1.5rem",
            }}
          />
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// Constant for display
const RETRY_DELAYS_COUNT = 3;
