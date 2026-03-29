import {
  fetchAggTrades,
  fetchAllTickers,
  fetchKlines,
  parseKlines,
} from "../binanceApi";
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
  ExecutionContext,
  Kline,
  MonitorStatus,
  SelectedMonitorSnapshot,
  TrendDirection,
} from "../types";

// ─── VERIFICATION THRESHOLDS (tuned for visibility phase) ───────────────────
// Lower these to raise thresholds once bubbles are confirmed visible.
const BUBBLE_DIR_THRESHOLD = 0.52; // 52% directional skew required
const BUBBLE_VOL_FLOOR = 0.05; // 5% of max bucket volume minimum
// ────────────────────────────────────────────────────────────────────────────

// Per-symbol+timeframe bubble persistence with TTL
const lastKnownBubblesMap = new Map<
  string,
  { bubbles: AggressionBubble[]; debug: BubbleDebugStats; ts: number }
>();
const BUBBLE_TTL_MS = 8000; // 8 seconds

const lastKnownExecutionMap = new Map<
  string,
  { ctx: ExecutionContext; ts: number }
>();
const EXECUTION_TTL_MS = 15000; // 15s — persists across short interruptions

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
  aggTrades: BinanceAggTrade[] | null,
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

  if (!aggTrades || aggTrades.length === 0 || candles.length === 0) {
    return { bubbles: [], debug: emptyDebug };
  }

  const intervalMs =
    timeframe === "15m" ? 900000 : timeframe === "5m" ? 300000 : 60000;

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

  // Bucket-relative floor: 5% of max sampled bucket volume
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
      // Strength: how far above 50% (0–100 scale)
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
    // Zone size = 3 candles. One dominant bubble per side per zone.
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
  const tensionHistory: number[] = [];
  const pressureHistory: number[] = [];

  // Load from cache immediately
  const cached = getCache<SelectedMonitorSnapshot>(
    `monitor_${symbol}_${timeframe}`,
  );
  if (cached) {
    onUpdate({ ...cached, status: "REFRESHING" });
    onStatus("REFRESHING");
  }

  async function tick() {
    if (cancelled || inFlight) return;
    inFlight = true;

    // Mark stale if no success recently
    if (lastSuccessTime > 0 && Date.now() - lastSuccessTime > 5000) {
      onStatus("STALE");
    }

    try {
      // Mandatory: tickers + klines
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

      // Optional: aggTrades — failure is safe, last known good is preserved
      const bubbleKey = `${symbol}_${timeframe}`;
      let aggressionBubbles: AggressionBubble[] = [];
      let bubbleDebug: BubbleDebugStats | undefined;
      try {
        if (!cancelled) {
          const aggTrades = await fetchAggTrades(symbol, 1000);
          if (aggTrades) {
            const result = buildAggressionBubbles(
              aggTrades,
              candles,
              timeframe,
            );
            const clustered = clusterBubbles(result.bubbles, candles);
            if (clustered.length > 0) {
              const freshDebug: BubbleDebugStats = {
                ...result.debug,
                greenBubbles: clustered.filter((b) => b.side === "BUY").length,
                redBubbles: clustered.filter((b) => b.side === "SELL").length,
                avgRadius: Math.round(
                  clustered.reduce((s, b) => s + b.radius, 0) /
                    clustered.length,
                ),
              };
              lastKnownBubblesMap.set(bubbleKey, {
                bubbles: clustered,
                debug: freshDebug,
                ts: Date.now(),
              });
              aggressionBubbles = clustered;
              bubbleDebug = freshDebug;
            } else {
              // No valid bubbles this tick — try to use last known good
              const prior = lastKnownBubblesMap.get(bubbleKey);
              if (prior && Date.now() - prior.ts < BUBBLE_TTL_MS) {
                aggressionBubbles = prior.bubbles;
                bubbleDebug = prior.debug;
              } else {
                lastKnownBubblesMap.delete(bubbleKey);
              }
            }
          } else {
            // fetchAggTrades returned null — preserve last known good
            const prior = lastKnownBubblesMap.get(bubbleKey);
            if (prior && Date.now() - prior.ts < BUBBLE_TTL_MS) {
              aggressionBubbles = prior.bubbles;
              bubbleDebug = prior.debug;
            } else {
              lastKnownBubblesMap.delete(bubbleKey);
            }
          }
        }
      } catch (aggErr) {
        console.warn(`[monitor aggTrades] ${symbol}:`, aggErr);
        // On exception — preserve last known good, do not blank the canvas
        const prior = lastKnownBubblesMap.get(bubbleKey);
        if (prior && Date.now() - prior.ts < BUBBLE_TTL_MS) {
          aggressionBubbles = prior.bubbles;
          bubbleDebug = prior.debug;
        } else {
          lastKnownBubblesMap.delete(bubbleKey);
        }
      }

      if (cancelled) {
        inFlight = false;
        return;
      }

      // === EXECUTION CONTEXT (last-known-good protected) ===
      // Only save to lastKnownExecutionMap when the computed result is truly valid
      // (hasCleanEntry === true). Weak/no-entry results fall back to the map
      // so overlays don't vanish on every oscillation of alignmentScore.
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
        );
        if (computed.hasCleanEntry) {
          // Valid state — save as last-known-good
          lastKnownExecutionMap.set(execKey, { ctx: computed, ts: Date.now() });
          setCache(
            `pbr_execution_${symbol}_${timeframe}`,
            computed,
            EXECUTION_TTL_MS,
          );
          executionContext = computed;
        } else {
          // Weak/no-entry — preserve last-known-good if within TTL
          const priorExec = lastKnownExecutionMap.get(execKey);
          if (priorExec && Date.now() - priorExec.ts < EXECUTION_TTL_MS) {
            executionContext = priorExec.ctx;
          } else {
            // TTL expired — show the current weak state honestly
            lastKnownExecutionMap.delete(execKey);
            executionContext = computed;
          }
        }
      } else {
        const priorExec = lastKnownExecutionMap.get(execKey);
        if (priorExec && Date.now() - priorExec.ts < EXECUTION_TTL_MS) {
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
  };
}
