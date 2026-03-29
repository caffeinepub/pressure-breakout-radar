import {
  bootstrapRestAggTrades,
  getAggTradeBuffer,
  getWsStatus,
  isAggRestBanned,
  restBanRemainingMs,
  subscribeAggTradeStream,
} from "../aggTradeWs";
import { fetchAllTickers, fetchKlines, parseKlines } from "../binanceApi";
import type { BinanceAggTrade } from "../binanceApi";
import { getCache, setCache } from "../cache";
import {
  assignPhase,
  computeBreakoutScore,
  computeExecutionContext,
  computePressure,
  computeTension,
  computeVacuumZone,
} from "../scoringEngine";
import { useHealthStore } from "../stores/healthStore";
import type {
  AggressionBubble,
  BreakoutBias,
  BreakoutContext,
  BubbleDebugStats,
  BubbleFetchDiagnostics,
  ExecutionContext,
  Kline,
  MonitorStatus,
  SelectedMonitorSnapshot,
  TrendDirection,
} from "../types";

// ─── VERIFICATION THRESHOLDS (tuned for visibility phase) ─────────────────
const BUBBLE_DIR_THRESHOLD = 0.52;
const BUBBLE_VOL_FLOOR = 0.05;

// ─── BUBBLE PERSISTENCE ────────────────────────────────────────────────────
const BUBBLE_TTL_MS = 30_000;

const lastKnownBubblesMap = new Map<
  string,
  {
    bubbles: AggressionBubble[];
    debug: BubbleDebugStats;
    ts: number;
    successTs: number;
    bubbleCount: number;
  }
>();

const lastKnownExecutionMap = new Map<
  string,
  { ctx: ExecutionContext; ts: number; ttl?: number }
>();
const EXECUTION_TTL_MS = 15_000;

// ─── HELPERS ───────────────────────────────────────────────────────────────

function computeBreakoutContext(
  klines: Kline[],
  currentPrice: number,
): BreakoutContext {
  const lookback = klines.slice(-50);
  const upperStructure = Math.max(...lookback.map((k) => k.high));
  const lowerStructure = Math.min(...lookback.map((k) => k.low));
  const distanceToUpper =
    ((upperStructure - currentPrice) / currentPrice) * 100;
  const distanceToLower =
    ((currentPrice - lowerStructure) / currentPrice) * 100;
  const bias: BreakoutBias =
    distanceToUpper < distanceToLower
      ? "UP"
      : distanceToLower < distanceToUpper
        ? "DOWN"
        : "NEUTRAL";
  return {
    upperStructure,
    lowerStructure,
    distanceToUpper,
    distanceToLower,
    bias,
  };
}

const TREND_WINDOW = 8;

function computeRollingTrend(history: number[], next: number): TrendDirection {
  history.push(next);
  if (history.length > TREND_WINDOW) history.shift();
  if (history.length < 3) return "FLAT";
  const half = Math.floor(history.length / 2);
  const earlyAvg = history.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const lateAvg = history.slice(-half).reduce((a, b) => a + b, 0) / half;
  const diff = lateAvg - earlyAvg;
  if (diff >= 2.5) return "RISING";
  if (diff <= -2.5) return "FALLING";
  return "FLAT";
}

function getBubbleRadius(strength: number): number {
  if (strength >= 75) return 22;
  if (strength >= 50) return 18;
  if (strength >= 25) return 14;
  return 10;
}

interface BuildResult {
  bubbles: AggressionBubble[];
  debug: BubbleDebugStats;
}

function buildAggressionBubbles(
  aggTrades: BinanceAggTrade[],
  candles: Kline[],
  timeframe: "1m" | "5m" | "15m",
): BuildResult {
  const emptyDebug: BubbleDebugStats = {
    eventsDetected: 0,
    greenBubbles: 0,
    redBubbles: 0,
    avgRadius: 0,
    maxStrength: 0,
    dirThreshold: BUBBLE_DIR_THRESHOLD,
    volFloor: BUBBLE_VOL_FLOOR,
  };

  if (aggTrades.length === 0 || candles.length === 0) {
    return { bubbles: [], debug: emptyDebug };
  }

  const intervalMs =
    timeframe === "15m" ? 900_000 : timeframe === "5m" ? 300_000 : 60_000;

  const buckets = new Map<
    number,
    { buyVol: number; sellVol: number; prices: number[] }
  >();

  for (const t of aggTrades) {
    const bucketTs = Math.floor(t.T / intervalMs) * intervalMs;
    if (!buckets.has(bucketTs))
      buckets.set(bucketTs, { buyVol: 0, sellVol: 0, prices: [] });
    const b = buckets.get(bucketTs)!;
    const vol = Number.parseFloat(t.q);
    if (t.m) b.sellVol += vol;
    else b.buyVol += vol;
    b.prices.push(Number.parseFloat(t.p));
  }

  const bucketTotals = Array.from(buckets.values()).map(
    (b) => b.buyVol + b.sellVol,
  );
  const maxBucketVol = bucketTotals.length > 0 ? Math.max(...bucketTotals) : 0;
  const minVolThreshold = maxBucketVol * BUBBLE_VOL_FLOOR;

  const bubbles: AggressionBubble[] = [];
  let eventsDetected = 0;

  for (const candle of candles) {
    const b = buckets.get(candle.openTime);
    if (!b) continue;
    const total = b.buyVol + b.sellVol;
    if (maxBucketVol > 0 && total < minVolThreshold) continue;

    eventsDetected++;
    const buyRatio = b.buyVol / total;
    const sellRatio = b.sellVol / total;

    if (buyRatio >= BUBBLE_DIR_THRESHOLD) {
      const strength = Math.min(100, Math.round((buyRatio - 0.5) * 200));
      bubbles.push({
        candleOpenTime: candle.openTime,
        price: (candle.low + Math.min(candle.open, candle.close)) / 2,
        side: "BUY",
        strength,
        radius: getBubbleRadius(strength),
      });
    } else if (sellRatio >= BUBBLE_DIR_THRESHOLD) {
      const strength = Math.min(100, Math.round((sellRatio - 0.5) * 200));
      bubbles.push({
        candleOpenTime: candle.openTime,
        price: (candle.high + Math.max(candle.open, candle.close)) / 2,
        side: "SELL",
        strength,
        radius: getBubbleRadius(strength),
      });
    }
  }

  const greenBubbles = bubbles.filter((b) => b.side === "BUY").length;
  const redBubbles = bubbles.filter((b) => b.side === "SELL").length;
  const avgRadius =
    bubbles.length > 0
      ? Math.round(bubbles.reduce((s, b) => s + b.radius, 0) / bubbles.length)
      : 0;
  const maxStrength =
    bubbles.length > 0 ? Math.max(...bubbles.map((b) => b.strength)) : 0;

  return {
    bubbles,
    debug: {
      eventsDetected,
      greenBubbles,
      redBubbles,
      avgRadius,
      maxStrength,
      dirThreshold: BUBBLE_DIR_THRESHOLD,
      volFloor: BUBBLE_VOL_FLOOR,
    },
  };
}

function clusterBubbles(
  bubbles: AggressionBubble[],
  candles: Kline[],
): AggressionBubble[] {
  const candleIndexMap = new Map<number, number>();
  candles.forEach((c, i) => candleIndexMap.set(c.openTime, i));

  const kept: AggressionBubble[] = [];
  const usedZones = new Map<string, number>();

  for (const b of bubbles) {
    const ci = candleIndexMap.get(b.candleOpenTime) ?? -1;
    if (ci < 0) continue;
    const zone = Math.floor(ci / 3);
    const key = `${b.side}_${zone}`;
    const existing = usedZones.get(key) ?? -1;
    if (b.strength > existing) {
      usedZones.set(key, b.strength);
      const idx = kept.findIndex((k) => {
        const ki = candleIndexMap.get(k.candleOpenTime) ?? -1;
        return k.side === b.side && Math.floor(ki / 3) === zone;
      });
      if (idx >= 0) kept.splice(idx, 1);
      kept.push(b);
    }
  }
  return kept;
}

// ─── MAIN LOOP ─────────────────────────────────────────────────────────────

export function startMonitorLoop(
  symbol: string,
  timeframe: "1m" | "5m" | "15m",
  onUpdate: (snapshot: Partial<SelectedMonitorSnapshot>) => void,
  onStatus: (status: MonitorStatus) => void,
): () => void {
  let cancelled = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let lastSuccessTime = 0;
  let bootstrapDone = false;
  const tensionHistory: number[] = [];
  const pressureHistory: number[] = [];
  const bubbleKey = `${symbol}_${timeframe}`;

  // ── Load from cache immediately ────────────────────────────────────────
  const cached = getCache<SelectedMonitorSnapshot>(
    `monitor_${symbol}_${timeframe}`,
  );
  if (cached) {
    onUpdate({ ...cached, status: "REFRESHING" });
    onStatus("REFRESHING");
  }

  // ── Subscribe to WebSocket aggTrade stream ─────────────────────────────
  // The WS runs independently; the tick loop just reads from its buffer.
  const unsubWs = subscribeAggTradeStream(symbol);

  // ── One-shot REST bootstrap (runs in background, non-blocking) ─────────
  async function doBootstrap() {
    if (bootstrapDone || isAggRestBanned()) return;
    await bootstrapRestAggTrades(symbol, 1000);
    bootstrapDone = true;
  }
  doBootstrap();

  // ── Build bubble layer from WS buffer ─────────────────────────────────
  function buildBubblesFromBuffer(candles: Kline[]): {
    aggressionBubbles: AggressionBubble[];
    bubbleDebug: BubbleDebugStats | undefined;
    bubbleLoopStatus: SelectedMonitorSnapshot["bubbleLoopStatus"];
    bubbleLastFetchCause: string | undefined;
    bubbleFetchDiagnostics: BubbleFetchDiagnostics | undefined;
  } {
    const wsStatus = getWsStatus(symbol);
    const priorEntry = lastKnownBubblesMap.get(bubbleKey);

    const diagBase: BubbleFetchDiagnostics = {
      symbol,
      timeframe,
      lastSuccessTs: priorEntry?.successTs ?? 0,
      lastSuccessBubbleCount: priorEntry?.bubbleCount ?? 0,
    };

    // Map WS connection state to a loop status label
    let bubbleLoopStatus: SelectedMonitorSnapshot["bubbleLoopStatus"];
    if (wsStatus === "LIVE") {
      bubbleLoopStatus = "WS_LIVE";
    } else if (wsStatus === "CONNECTING") {
      bubbleLoopStatus = "WS_CONNECTING";
    } else if (wsStatus === "RECONNECTING" || wsStatus === "ERROR") {
      bubbleLoopStatus = "WS_RECONNECTING";
    } else {
      bubbleLoopStatus = "BOOTSTRAPPING";
    }

    const buffer = getAggTradeBuffer(symbol);

    // If buffer has data, compute bubbles regardless of WS connection state
    if (buffer.length > 0) {
      const result = buildAggressionBubbles(buffer, candles, timeframe);
      const clustered = clusterBubbles(result.bubbles, candles);

      if (clustered.length > 0) {
        const freshDebug: BubbleDebugStats = {
          ...result.debug,
          greenBubbles: clustered.filter((b) => b.side === "BUY").length,
          redBubbles: clustered.filter((b) => b.side === "SELL").length,
          avgRadius: Math.round(
            clustered.reduce((s, b) => s + b.radius, 0) / clustered.length,
          ),
        };
        const nowTs = Date.now();
        lastKnownBubblesMap.set(bubbleKey, {
          bubbles: clustered,
          debug: freshDebug,
          ts: nowTs,
          successTs: nowTs,
          bubbleCount: clustered.length,
        });

        if (wsStatus === "LIVE") bubbleLoopStatus = "WS_LIVE";

        return {
          aggressionBubbles: clustered,
          bubbleDebug: freshDebug,
          bubbleLoopStatus,
          bubbleLastFetchCause: "WS_BUFFER",
          bubbleFetchDiagnostics: {
            ...diagBase,
            lastSuccessTs: nowTs,
            lastSuccessBubbleCount: clustered.length,
          },
        };
      }
      // Buffer had trades but no qualifying bucket — valid market state
      if (wsStatus === "LIVE") bubbleLoopStatus = "NO_EVENTS";
    }

    // No qualifying bubbles from buffer — try to serve last-known-good
    const prior = lastKnownBubblesMap.get(bubbleKey);
    if (prior && Date.now() - prior.ts < BUBBLE_TTL_MS) {
      return {
        aggressionBubbles: prior.bubbles,
        bubbleDebug: prior.debug,
        bubbleLoopStatus,
        bubbleLastFetchCause:
          buffer.length === 0 ? "WS_BUFFER_EMPTY" : "WS_NO_EVENTS",
        bubbleFetchDiagnostics: diagBase,
      };
    }

    // REST ban info in diagnostics
    const banMs = restBanRemainingMs();
    const diagWithBan: BubbleFetchDiagnostics = {
      ...diagBase,
      ...(banMs > 0
        ? {
            failureType: "HTTP_ERROR" as const,
            errorMessage: `REST banned for ${Math.ceil(banMs / 1000)}s more`,
          }
        : {}),
    };

    return {
      aggressionBubbles: [],
      bubbleDebug: undefined,
      bubbleLoopStatus,
      bubbleLastFetchCause:
        buffer.length === 0 ? "WS_BUFFER_EMPTY" : "WS_NO_EVENTS",
      bubbleFetchDiagnostics: diagWithBan,
    };
  }

  async function tick() {
    if (cancelled || inFlight) return;
    inFlight = true;

    if (lastSuccessTime > 0 && Date.now() - lastSuccessTime > 5000) {
      onStatus("STALE");
    }

    try {
      const [tickers, rawKlines] = await Promise.all([
        fetchAllTickers(),
        fetchKlines(symbol, timeframe, 100),
      ]);

      if (cancelled) {
        inFlight = false;
        return;
      }

      if (!tickers || !rawKlines) {
        useHealthStore.getState().incrementFailedRequests();
        if (lastSuccessTime === 0) {
          const hasCached = !!getCache<SelectedMonitorSnapshot>(
            `monitor_${symbol}_${timeframe}`,
          );
          if (!hasCached) onStatus("ERROR");
          else onStatus("STALE");
        }
        inFlight = false;
        return;
      }

      const ticker = tickers.find((t) => t.symbol === symbol);
      if (!ticker) {
        if (
          lastSuccessTime === 0 &&
          !getCache<SelectedMonitorSnapshot>(`monitor_${symbol}_${timeframe}`)
        ) {
          onStatus("ERROR");
        }
        inFlight = false;
        return;
      }

      const candles = parseKlines(rawKlines);
      const currentPrice = Number.parseFloat(ticker.lastPrice);
      const priceChangePct = Number.parseFloat(ticker.priceChangePercent);

      const tension = computeTension(candles);
      const pressure = computePressure(priceChangePct);
      const breakoutScore = computeBreakoutScore(tension, pressure, candles);
      const phase = assignPhase(tension, pressure, breakoutScore, candles);
      const breakoutContext =
        candles.length >= 10
          ? computeBreakoutContext(candles, currentPrice)
          : null;

      const tensionTrend = computeRollingTrend(tensionHistory, tension);
      const pressureTrend = computeRollingTrend(
        pressureHistory,
        pressure.strength,
      );

      const vacuumZone = computeVacuumZone(candles, currentPrice);

      // ── AGGRESSION BUBBLES (WS-primary, no REST polling) ────────────────
      const {
        aggressionBubbles,
        bubbleDebug,
        bubbleLoopStatus,
        bubbleLastFetchCause,
        bubbleFetchDiagnostics,
      } = buildBubblesFromBuffer(candles);

      if (cancelled) {
        inFlight = false;
        return;
      }

      // ── EXECUTION CONTEXT ───────────────────────────────────────────────
      const execKey = `${symbol}_${timeframe}`;
      let executionContext: ExecutionContext | undefined;
      if (breakoutContext && candles.length >= 15) {
        const computed = computeExecutionContext(
          candles,
          currentPrice,
          breakoutContext,
          vacuumZone,
          pressure,
          pressureTrend,
          tensionTrend,
          aggressionBubbles,
        );

        const isReclaimActive =
          computed.executionValidityState === "RECLAIM_LONG" ||
          computed.executionValidityState === "RECLAIM_SHORT" ||
          computed.executionValidityState === "RECLAIM_LONG_WAIT_RETEST" ||
          computed.executionValidityState === "RECLAIM_SHORT_WAIT_RETEST";

        if (computed.hasCleanEntry || isReclaimActive) {
          // Fresh valid execution with clean entry — update last-known-good map
          const qualityTtl = computed.executionInvalid
            ? 5_000
            : computed.executionQuality === "HIGH"
              ? 20_000
              : computed.executionQuality === "MEDIUM"
                ? 15_000
                : 8_000;
          lastKnownExecutionMap.set(execKey, {
            ctx: computed,
            ts: Date.now(),
            ttl: qualityTtl,
          });
          setCache(
            `pbr_execution_${symbol}_${timeframe}`,
            computed,
            EXECUTION_TTL_MS,
          );
          executionContext = computed;
        } else {
          // No clean entry (no aggression cluster, no-chase, or invalid) —
          // serve last-known-good execution context while it is still fresh.
          const priorExecFresh = lastKnownExecutionMap.get(execKey);
          if (
            priorExecFresh &&
            Date.now() - priorExecFresh.ts <
              (priorExecFresh.ttl ?? EXECUTION_TTL_MS)
          ) {
            executionContext = priorExecFresh.ctx;
          } else {
            // Prior expired — show current state (directional context but no entry zones)
            lastKnownExecutionMap.delete(execKey);
            executionContext = computed;
          }
        }
      } else {
        const priorExec = lastKnownExecutionMap.get(execKey);
        if (
          priorExec &&
          Date.now() - priorExec.ts < (priorExec.ttl ?? EXECUTION_TTL_MS)
        ) {
          executionContext = priorExec.ctx;
        } else {
          lastKnownExecutionMap.delete(execKey);
        }
      }

      lastSuccessTime = Date.now();
      useHealthStore.getState().setLastMonitorUpdateTime(lastSuccessTime);

      const snapshot: SelectedMonitorSnapshot = {
        symbol,
        price: currentPrice,
        phase,
        tension,
        tensionTrend,
        pressure,
        pressureTrend,
        breakoutScore,
        breakoutContext,
        candles,
        status: "LIVE",
        lastSuccessTime,
        aggressionBubbles,
        bubbleDebug,
        bubbleLoopStatus,
        bubbleRetryCount: 0,
        bubbleLastFetchCause,
        bubbleFetchDiagnostics,
        timeframe,
        vacuumZone,
        executionContext,
      };

      setCache(`monitor_${symbol}_${timeframe}`, snapshot, 8000);
      onUpdate(snapshot);
      onStatus("LIVE");
    } catch (err) {
      console.warn(`[monitor tick] ${symbol}:`, err);
      useHealthStore.getState().incrementFailedRequests();
      useHealthStore
        .getState()
        .setLastError(
          `monitor ${symbol}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      if (!cancelled) {
        const hasCached = !!getCache<SelectedMonitorSnapshot>(
          `monitor_${symbol}_${timeframe}`,
        );
        if (lastSuccessTime > 0 || hasCached) {
          onStatus("STALE");
        } else {
          onStatus("ERROR");
        }
      }
    } finally {
      inFlight = false;
    }
  }

  tick();
  intervalId = setInterval(tick, 1000);

  return () => {
    cancelled = true;
    if (intervalId !== null) clearInterval(intervalId);
    unsubWs();
  };
}
