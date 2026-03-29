import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { getCache } from "../../cache";
import { startMonitorLoop } from "../../loops/monitorLoop";
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

  // ── STABLE OVERLAY STATE ───────────────────────────────────────────────
  // These only update when truly valid data arrives.
  // Single bad ticks never blank the chart overlays.
  const [stableExecCtx, setStableExecCtx] = useState<ExecutionContext | null>(
    null,
  );
  const [stableBubbles, setStableBubbles] = useState<AggressionBubble[]>([]);
  const [execOverlayTs, setExecOverlayTs] = useState<number>(0);
  // ─────────────────────────────────────────────────────────────────────

  // biome-ignore lint/correctness/useExhaustiveDependencies: stable zustand actions, symbol/timeframe-keyed setup
  useEffect(() => {
    // Reset stable overlays on symbol/timeframe change — enforces isolation
    setStableExecCtx(null);
    setStableBubbles([]);
    setExecOverlayTs(0);

    const cached = getCache<SelectedMonitorSnapshot>(
      `monitor_${symbol}_${timeframe}`,
    );
    if (cached) {
      setSnapshot({ ...cached, status: "REFRESHING" });
      // Restore stable overlays from cache if available
      if (cached.executionContext) {
        setStableExecCtx(cached.executionContext);
        setExecOverlayTs(cached.lastSuccessTime ?? 0);
      }
      if (cached.aggressionBubbles && cached.aggressionBubbles.length > 0) {
        setStableBubbles(cached.aggressionBubbles);
      }
    } else {
      clearSnapshot();
    }

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
        // Update stable execution overlay for any computed execution context
        if (update.executionContext) {
          setStableExecCtx(update.executionContext);
          setExecOverlayTs(Date.now());
        }
        // Update stable bubbles only when we have a non-empty set
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
    };
  }, [symbol, timeframe]);

  const handleClose = () => setSelectedSymbol(null);
  const dbg = snapshot?.bubbleDebug;

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

        {/* Scrollable content — iOS smooth scroll */}
        <div
          className="relative z-10 flex flex-col flex-1 overflow-y-auto"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {/* Header area */}
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

          <div className="border-t border-[oklch(0.78_0.13_195/8%)]" />

          {/* Alignment Status Strip */}
          <div className="px-4 mt-1.5">
            <AlignmentStatusStrip
              breakoutBias={snapshot?.breakoutContext?.bias}
              pressureSide={snapshot?.pressure?.side}
            />
          </div>

          {/* Chart area — locked at 420px, never compressed */}
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

          {/* Execution Context — uses stable overlay, not raw tick output */}
          <div className="px-4 mt-2">
            <ExecutionContextBlock ctx={stableExecCtx} />
          </div>

          {/* ── BUBBLE DEBUG PILL (outside chart canvas, collapsible) ── */}
          <div className="px-4 mt-1.5">
            <button
              type="button"
              onClick={() => setDebugOpen((o) => !o)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[oklch(0.78_0.13_195/20%)] bg-[oklch(0.10_0.02_210/80%)] text-[9px] font-mono text-radar-dim hover:text-radar-cyan hover:border-[oklch(0.78_0.13_195/40%)] transition-all"
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{
                  background:
                    dbg && (dbg.greenBubbles > 0 || dbg.redBubbles > 0)
                      ? "oklch(0.72 0.17 145)"
                      : "oklch(0.45 0.05 200)",
                }}
              />
              <span>
                AGG BUBBLES
                {dbg
                  ? ` ▼ EV:${dbg.eventsDetected} G:${dbg.greenBubbles} R:${dbg.redBubbles}`
                  : snapshot?.bubbleLoopStatus === "RETRYING"
                    ? ` ▼ RETRY ${snapshot.bubbleRetryCount ?? "?"}/3`
                    : snapshot?.bubbleLoopStatus === "NO_EVENTS"
                      ? " ▼ NO EVENTS"
                      : snapshot?.bubbleLoopStatus === "STALE"
                        ? " ▼ STALE"
                        : snapshot?.bubbleLoopStatus === "FETCHING"
                          ? " ▼ FETCHING"
                          : " ▼ BOOTSTRAPPING"}
              </span>
              <span className="ml-auto opacity-50">
                {debugOpen ? "▲" : "▼"}
              </span>
            </button>

            {debugOpen && (
              <div className="mt-1 px-3 py-2 rounded-xl border border-[oklch(0.78_0.13_195/15%)] bg-[oklch(0.08_0.02_210/90%)] font-mono text-[9px] leading-relaxed">
                {dbg ? (
                  <>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      <span className="text-radar-dim">Events detected</span>
                      <span className="text-foreground">
                        {dbg.eventsDetected}
                      </span>

                      <span className="text-radar-dim">
                        Green bubbles (BUY)
                      </span>
                      <span style={{ color: "oklch(0.72 0.17 145)" }}>
                        {dbg.greenBubbles}
                      </span>

                      <span className="text-radar-dim">Red bubbles (SELL)</span>
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
                    {dbg.greenBubbles === 0 && dbg.redBubbles === 0 && (
                      <div className="mt-1.5 text-[8px] text-radar-dim opacity-70">
                        No bubbles this window — try a high-volume 1m pair or
                        wait for next tick
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-0.5">
                    <span
                      className="font-bold"
                      style={{
                        color:
                          snapshot?.bubbleLoopStatus === "STALE"
                            ? "oklch(0.65 0.20 25)"
                            : snapshot?.bubbleLoopStatus === "RETRYING"
                              ? "oklch(0.75 0.18 55)"
                              : snapshot?.bubbleLoopStatus === "NO_EVENTS"
                                ? "oklch(0.65 0.10 195)"
                                : "oklch(0.55 0.05 200)",
                      }}
                    >
                      {snapshot?.bubbleLoopStatus === "BOOTSTRAPPING"
                        ? "BOOTSTRAPPING"
                        : snapshot?.bubbleLoopStatus === "FETCHING"
                          ? "FETCHING AGG-TRADES"
                          : snapshot?.bubbleLoopStatus === "RETRYING"
                            ? `RETRY ${snapshot.bubbleRetryCount ?? "?"}/3`
                            : snapshot?.bubbleLoopStatus === "NO_EVENTS"
                              ? "FETCH OK / NO EVENTS"
                              : snapshot?.bubbleLoopStatus === "STALE"
                                ? "STALE TTL EXPIRED"
                                : "WAITING"}
                    </span>
                    {snapshot?.bubbleLastFetchCause && (
                      <div className="text-radar-dim/70">
                        cause:{" "}
                        <span className="text-radar-dim">
                          {snapshot.bubbleLastFetchCause}
                        </span>
                      </div>
                    )}
                    {snapshot?.bubbleLoopStatus === "NO_EVENTS" && (
                      <div className="text-radar-dim/60 text-[8px] mt-1">
                        Fetch succeeded — no bucket exceeded aggression
                        threshold this window
                      </div>
                    )}
                    {snapshot?.bubbleLoopStatus === "RETRYING" && (
                      <div className="text-radar-dim/60 text-[8px] mt-1">
                        Last known good bubbles preserved — retrying before
                        STALE
                      </div>
                    )}
                    {snapshot?.bubbleLoopStatus === "STALE" && (
                      <div className="text-radar-dim/60 text-[8px] mt-1">
                        3 retries exhausted — TTL expired with no valid data
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Exec overlay debug — lightweight verification */}
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

          {/* Bottom safe-area spacer for iOS home indicator */}
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
