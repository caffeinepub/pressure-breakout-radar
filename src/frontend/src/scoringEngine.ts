import type {
  AggressionBubble,
  Kline,
  Phase,
  PressureResult,
  PressureSide,
  VacuumSide,
  VacuumZone,
} from "./types";

export function computeTension(klines: Kline[]): number {
  if (klines.length < 10) return 0;

  const lookback = Math.min(20, klines.length);
  const closes = klines.slice(-lookback).map((k) => k.close);
  const mean = closes.reduce((a, b) => a + b, 0) / closes.length;
  if (mean === 0) return 0;

  const variance =
    closes.reduce((sum, c) => sum + (c - mean) ** 2, 0) / closes.length;
  const stdDev = Math.sqrt(variance);
  const bbWidth = (4 * stdDev) / mean;

  // ATR
  const recent = klines.slice(-lookback);
  let totalTR = 0;
  for (let i = 1; i < recent.length; i++) {
    const hl = recent[i].high - recent[i].low;
    const hc = Math.abs(recent[i].high - recent[i - 1].close);
    const lc = Math.abs(recent[i].low - recent[i - 1].close);
    totalTR += Math.max(hl, hc, lc);
  }
  const atr = totalTR / Math.max(1, recent.length - 1);
  const atrRatio = atr / mean;

  // Lower bbWidth + lower atrRatio = higher tension
  const bbScore = Math.max(0, 1 - bbWidth * 25);
  const atrScore = Math.max(0, 1 - atrRatio * 40);
  const tension = (bbScore * 0.6 + atrScore * 0.4) * 100;

  return Math.min(100, Math.max(0, tension));
}

export function computePressure(priceChangePercent: number): PressureResult {
  let side: PressureSide;
  if (priceChangePercent > 0.5) side = "UP";
  else if (priceChangePercent < -0.5) side = "DOWN";
  else side = "NEUTRAL";

  // Map pct to 0-100: 10% change → 100 strength
  const strength = Math.min(100, Math.abs(priceChangePercent) * 10);

  return { side, strength };
}

export function computeBreakoutScore(
  tension: number,
  pressure: PressureResult,
  klines: Kline[],
): number {
  if (klines.length < 5) return 0;

  const lookback = Math.min(50, klines.length);
  const recent = klines.slice(-lookback);
  const highestHigh = Math.max(...recent.map((k) => k.high));
  const lowestLow = Math.min(...recent.map((k) => k.low));
  const currentPrice = klines[klines.length - 1].close;
  const range = highestHigh - lowestLow;

  let structureProximity = 0;
  if (range > 0) {
    const pos = (currentPrice - lowestLow) / range;
    // Closer to high or low = higher proximity
    const proximity = Math.max(pos, 1 - pos);
    structureProximity = Math.max(0, (proximity - 0.5) * 2) * 100;
  }

  const score =
    tension * 0.4 + pressure.strength * 0.35 + structureProximity * 0.25;
  return Math.min(100, Math.max(0, score));
}

export function assignPhase(
  tension: number,
  pressure: PressureResult,
  breakoutScore: number,
  klines: Kline[],
): Phase {
  // PRE-BURST: highly compressed near structure
  if (tension > 60 && breakoutScore > 55) return "PRE-BURST";

  // BREAKOUT: price broke recent structure
  if (klines.length >= 20) {
    const currentPrice = klines[klines.length - 1].close;
    const anchor = klines.slice(-50, -5);
    if (anchor.length >= 10) {
      const earlyHigh = Math.max(...anchor.map((k) => k.high));
      const earlyLow = Math.min(...anchor.map((k) => k.low));
      if (currentPrice > earlyHigh * 1.002 || currentPrice < earlyLow * 0.998) {
        return "BREAKOUT";
      }
    }
  }

  // ACTIVE: strong directional pressure
  if (pressure.strength > 60 && pressure.side !== "NEUTRAL") return "ACTIVE";

  // BUILDING: loading up
  if (breakoutScore >= 20 && tension > 30) return "BUILDING";

  return "FLAT";
}

export function computeVacuumSide(
  klines: Kline[],
  currentPrice: number,
): VacuumSide {
  if (klines.length < 15) return "NONE";

  const recent = klines.slice(-30);
  const minPrice = Math.min(...recent.map((k) => k.low));
  const maxPrice = Math.max(...recent.map((k) => k.high));
  const range = maxPrice - minPrice;
  if (range <= 0) return "NONE";

  const BUCKETS = 10;
  const bucketSize = range / BUCKETS;
  const volumeByBucket = new Array<number>(BUCKETS).fill(0);

  for (const k of recent) {
    const mid = (k.high + k.low) / 2;
    const bucket = Math.min(
      BUCKETS - 1,
      Math.floor((mid - minPrice) / bucketSize),
    );
    volumeByBucket[bucket] += k.volume;
  }

  const avgVol = volumeByBucket.reduce((a, b) => a + b, 0) / BUCKETS;
  const threshold = avgVol * 0.3;
  const currentBucket = Math.min(
    BUCKETS - 1,
    Math.floor((currentPrice - minPrice) / bucketSize),
  );

  let minAboveVol = Number.POSITIVE_INFINITY;
  let minBelowVol = Number.POSITIVE_INFINITY;

  for (let i = currentBucket + 1; i < BUCKETS; i++) {
    if (volumeByBucket[i] < minAboveVol) minAboveVol = volumeByBucket[i];
  }
  for (let i = 0; i < currentBucket; i++) {
    if (volumeByBucket[i] < minBelowVol) minBelowVol = volumeByBucket[i];
  }

  const hasAbove = minAboveVol < threshold;
  const hasBelow = minBelowVol < threshold;

  if (hasAbove && hasBelow) {
    return minAboveVol < minBelowVol ? "ABOVE" : "BELOW";
  }
  if (hasAbove) return "ABOVE";
  if (hasBelow) return "BELOW";
  return "NONE";
}

export function computeVacuumZone(
  klines: Kline[],
  currentPrice: number,
): VacuumZone {
  if (klines.length < 15) return { side: "NONE", startPrice: 0, endPrice: 0 };

  const recent = klines.slice(-30);
  const minPrice = Math.min(...recent.map((k) => k.low));
  const maxPrice = Math.max(...recent.map((k) => k.high));
  const range = maxPrice - minPrice;
  if (range <= 0) return { side: "NONE", startPrice: 0, endPrice: 0 };

  const BUCKETS = 10;
  const bucketSize = range / BUCKETS;
  const volumeByBucket = new Array<number>(BUCKETS).fill(0);

  for (const k of recent) {
    const mid = (k.high + k.low) / 2;
    const bucket = Math.min(
      BUCKETS - 1,
      Math.floor((mid - minPrice) / bucketSize),
    );
    volumeByBucket[bucket] += k.volume;
  }

  const avgVol = volumeByBucket.reduce((a, b) => a + b, 0) / BUCKETS;
  const threshold = avgVol * 0.3;
  const currentBucket = Math.min(
    BUCKETS - 1,
    Math.floor((currentPrice - minPrice) / bucketSize),
  );

  // Find the emptiest bucket above current price
  let bestAboveBucket = -1;
  let minAboveVol = Number.POSITIVE_INFINITY;
  for (let i = currentBucket + 1; i < BUCKETS; i++) {
    if (volumeByBucket[i] < minAboveVol) {
      minAboveVol = volumeByBucket[i];
      bestAboveBucket = i;
    }
  }

  // Find the emptiest bucket below current price
  let bestBelowBucket = -1;
  let minBelowVol = Number.POSITIVE_INFINITY;
  for (let i = 0; i < currentBucket; i++) {
    if (volumeByBucket[i] < minBelowVol) {
      minBelowVol = volumeByBucket[i];
      bestBelowBucket = i;
    }
  }

  const hasAbove = bestAboveBucket >= 0 && minAboveVol < threshold;
  const hasBelow = bestBelowBucket >= 0 && minBelowVol < threshold;

  if (!hasAbove && !hasBelow)
    return { side: "NONE", startPrice: 0, endPrice: 0 };

  let side: VacuumSide;
  let targetBucket: number;

  if (hasAbove && hasBelow) {
    if (minAboveVol <= minBelowVol) {
      side = "ABOVE";
      targetBucket = bestAboveBucket;
    } else {
      side = "BELOW";
      targetBucket = bestBelowBucket;
    }
  } else if (hasAbove) {
    side = "ABOVE";
    targetBucket = bestAboveBucket;
  } else {
    side = "BELOW";
    targetBucket = bestBelowBucket!;
  }

  const startPrice = minPrice + targetBucket * bucketSize;
  const endPrice = startPrice + bucketSize;

  return { side, startPrice, endPrice };
}

import type {
  BreakoutContext,
  EntryBias,
  ExecutionContext,
  ExecutionQuality,
  ExecutionZone,
  RangePosition,
  TrendDirection,
} from "./types";

function computeATR(klines: Kline[], period = 14): number {
  const recent = klines.slice(-(period + 1));
  if (recent.length < 2) return 0;
  let totalTR = 0;
  for (let i = 1; i < recent.length; i++) {
    const hl = recent[i].high - recent[i].low;
    const hc = Math.abs(recent[i].high - recent[i - 1].close);
    const lc = Math.abs(recent[i].low - recent[i - 1].close);
    totalTR += Math.max(hl, hc, lc);
  }
  return totalTR / (recent.length - 1);
}

// ---------------------------------------------------------------------------
// AGGRESSION CLUSTER FINDER
// Finds the dominant aggression cluster from recent bubbles.
// Returns the weighted center price, strength, and price range of the cluster.
// ---------------------------------------------------------------------------
interface AggressionCluster {
  centerPrice: number;
  strength: number;
  lowPrice: number;
  highPrice: number;
}

function findAggressionCluster(
  bubbles: AggressionBubble[],
  side: "BUY" | "SELL",
  atr: number,
): AggressionCluster | null {
  const relevant = bubbles.filter((b) => b.side === side);
  if (relevant.length === 0) return null;

  // Anchor to the strongest bubble
  const strongest = relevant.reduce((best, b) =>
    b.strength > best.strength ? b : best,
  );

  // Cluster = all bubbles within 2 ATR of the strongest
  const clusterRadius = Math.max(atr * 2.0, strongest.price * 0.003);
  const cluster = relevant.filter(
    (b) => Math.abs(b.price - strongest.price) <= clusterRadius,
  );
  if (cluster.length === 0) return null;

  const totalStrength = cluster.reduce((s, b) => s + b.strength, 0);
  if (totalStrength === 0) return null;

  const centerPrice =
    cluster.reduce((s, b) => s + b.price * b.strength, 0) / totalStrength;
  const maxStrength = Math.max(...cluster.map((b) => b.strength));
  const lowPrice = Math.min(...cluster.map((b) => b.price));
  const highPrice = Math.max(...cluster.map((b) => b.price));

  return { centerPrice, strength: maxStrength, lowPrice, highPrice };
}

/**
 * Validates the computed execution zones for directional and mathematical
 * consistency. Returns null if valid, or a string reason if invalid.
 */
function validateExecutionZones(
  bias: EntryBias,
  entryZone: ExecutionZone,
  slZone: ExecutionZone,
  tp1Zone: ExecutionZone,
  tp2Zone: ExecutionZone | null,
): string | null {
  const entryMid = (entryZone.start + entryZone.end) / 2;
  const slMid = (slZone.start + slZone.end) / 2;
  const tp1Mid = (tp1Zone.start + tp1Zone.end) / 2;

  if (bias === "LONG") {
    if (slMid >= entryMid) return "NO VALID LONG REWARD PATH";
    if (tp1Mid <= entryZone.end) return "INVALID LONG EXECUTION";
    if (tp2Zone !== null) {
      const tp2Mid = (tp2Zone.start + tp2Zone.end) / 2;
      if (tp2Mid <= tp1Mid) return "INVALID LONG EXECUTION";
    }
  } else if (bias === "SHORT") {
    if (slMid <= entryMid) return "NO VALID SHORT REWARD PATH";
    if (tp1Mid >= entryZone.start) return "INVALID SHORT EXECUTION";
    if (tp2Zone !== null) {
      const tp2Mid = (tp2Zone.start + tp2Zone.end) / 2;
      if (tp2Mid >= tp1Mid) return "INVALID SHORT EXECUTION";
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// RECLAIM SETUP DETECTOR
// Detects failed-aggression reclaim setups as a second execution model.
// LONG reclaim: bearish cluster that price has moved above (failed sellers)
// SHORT reclaim: bullish cluster that price has moved below (failed buyers)
// ---------------------------------------------------------------------------
interface ReclaimSetup {
  type: "LONG_RECLAIM" | "SHORT_RECLAIM";
  entryZone: ExecutionZone;
  slZone: ExecutionZone;
  isExtended: boolean; // price too far from reclaim zone — wait for retest
  quality: ExecutionQuality;
}

function computeReclaimSetup(
  bubbles: AggressionBubble[],
  currentPrice: number,
  atr: number,
  upperStructure: number,
  lowerStructure: number,
  existingBias: EntryBias,
  pressure: PressureResult,
  pressureTrend: TrendDirection,
  rangePosition: RangePosition,
  tfScale = 1.0,
): ReclaimSetup | null {
  const rangeSize = Math.max(upperStructure - lowerStructure, atr * 3);

  // --- LONG RECLAIM: bearish cluster that price has reclaimed above ---
  // Only if existing bias is not strongly SHORT
  if (existingBias !== "SHORT") {
    const bearishCluster = findAggressionCluster(bubbles, "SELL", atr);
    if (bearishCluster && bearishCluster.strength >= 6) {
      const reclaimBuffer = atr * 0.15;
      if (currentPrice > bearishCluster.highPrice + reclaimBuffer) {
        // Price reclaimed above the bearish cluster — potential LONG reclaim
        const entryZone: ExecutionZone = {
          start: bearishCluster.centerPrice - atr * 0.2 * tfScale,
          end: bearishCluster.highPrice + atr * 0.2 * tfScale,
        };
        const slZone: ExecutionZone = {
          start: bearishCluster.lowPrice - atr * 0.5 * tfScale,
          end: bearishCluster.lowPrice - atr * 0.05,
        };
        // No-chase: price too far above the reclaim zone (wait for retest back to zone)
        const isExtended = currentPrice > entryZone.end + atr * 1.5 * tfScale;

        // Quality: based on confirmation signals
        const confirmations = [
          pressure.side !== "DOWN",
          pressureTrend === "RISING",
          rangePosition !== "LOWER",
        ].filter(Boolean).length;
        const quality: ExecutionQuality =
          confirmations >= 3 ? "HIGH" : confirmations >= 2 ? "MEDIUM" : "LOW";

        return { type: "LONG_RECLAIM", entryZone, slZone, isExtended, quality };
      }
    }
  }

  // --- SHORT RECLAIM: bullish cluster that price has broken below ---
  // Only if existing bias is not strongly LONG
  if (existingBias !== "LONG") {
    const bullishCluster = findAggressionCluster(bubbles, "BUY", atr);
    if (bullishCluster && bullishCluster.strength >= 6) {
      const reclaimBuffer = atr * 0.15;
      if (currentPrice < bullishCluster.lowPrice - reclaimBuffer) {
        // Price broke below the bullish cluster — potential SHORT reclaim
        const entryZone: ExecutionZone = {
          start: bullishCluster.lowPrice - atr * 0.2 * tfScale,
          end: bullishCluster.centerPrice + atr * 0.2 * tfScale,
        };
        const slZone: ExecutionZone = {
          start: bullishCluster.highPrice + atr * 0.05,
          end: bullishCluster.highPrice + atr * 0.5 * tfScale,
        };
        // No-chase: price too far below the reclaim zone
        const isExtended = currentPrice < entryZone.start - atr * 1.5 * tfScale;

        const confirmations = [
          pressure.side !== "UP",
          pressureTrend === "RISING",
          rangePosition !== "UPPER",
        ].filter(Boolean).length;
        const quality: ExecutionQuality =
          confirmations >= 3 ? "HIGH" : confirmations >= 2 ? "MEDIUM" : "LOW";

        return {
          type: "SHORT_RECLAIM",
          entryZone,
          slZone,
          isExtended,
          quality,
        };
      }
    }
  }

  // Also check VOID (no existing bias) — check both directions, pick stronger cluster
  if (existingBias === "NEUTRAL") {
    // Already covered above since NEUTRAL is not SHORT and not LONG
  }

  void rangeSize; // suppress unused warning
  return null;
}

export function computeExecutionContext(
  klines: Kline[],
  currentPrice: number,
  breakoutContext: BreakoutContext,
  vacuumZone: VacuumZone,
  pressure: PressureResult,
  pressureTrend: TrendDirection,
  tensionTrend: TrendDirection,
  aggressionBubbles: AggressionBubble[] = [],
  timeframe = "1m",
): ExecutionContext {
  const { upperStructure, lowerStructure, bias } = breakoutContext;
  const rangeSpan = Math.max(
    upperStructure - lowerStructure,
    currentPrice * 0.0001,
  );
  const rangeValue = Math.max(
    0,
    Math.min(1, (currentPrice - lowerStructure) / rangeSpan),
  );
  const rangePosition: RangePosition =
    rangeValue <= 0.33 ? "LOWER" : rangeValue <= 0.66 ? "MID" : "UPPER";

  // ---------------------------------------------------------------------------
  // SIGNAL SCORING
  // ---------------------------------------------------------------------------
  const longSignals = [
    bias === "UP",
    vacuumZone.side === "ABOVE",
    rangePosition === "UPPER",
    pressure.side === "UP",
    pressureTrend === "RISING",
    tensionTrend === "RISING",
  ];
  const shortSignals = [
    bias === "DOWN",
    vacuumZone.side === "BELOW" ||
      (vacuumZone.side === "ABOVE" && bias === "DOWN"),
    rangePosition === "LOWER",
    pressure.side === "DOWN",
    pressureTrend === "RISING",
    tensionTrend === "RISING",
  ];
  const longScore = longSignals.filter(Boolean).length;
  const shortScore = shortSignals.filter(Boolean).length;

  // Directional state — independent of execution validity
  let directionalState: string;
  if (longScore >= 5) directionalState = "FULL_LONG";
  else if (shortScore >= 5) directionalState = "FULL_SHORT";
  else if (longScore >= 3 && longScore >= shortScore)
    directionalState = "LONG_LEAN";
  else if (shortScore >= 3 && shortScore > longScore)
    directionalState = "SHORT_LEAN";
  else if (Math.abs(longScore - shortScore) <= 1 && longScore >= 2)
    directionalState = "CONFLICT";
  else directionalState = "NO_CLEAR";

  let entryBias: EntryBias = "NEUTRAL";
  let alignmentScore = 0;
  if (longScore >= 4 && longScore >= shortScore) {
    entryBias = "LONG";
    alignmentScore = longScore;
  } else if (shortScore >= 4 && shortScore > longScore) {
    entryBias = "SHORT";
    alignmentScore = shortScore;
  } else {
    alignmentScore = Math.max(longScore, shortScore);
  }

  let executionQuality: ExecutionQuality =
    alignmentScore >= 6 ? "HIGH" : alignmentScore >= 4 ? "MEDIUM" : "LOW";
  const hasCleanEntry = entryBias !== "NEUTRAL";

  let entryZone: ExecutionZone | null = null;
  let slZone: ExecutionZone | null = null;
  let tp1Zone: ExecutionZone | null = null;
  let tp2Zone: ExecutionZone | null = null;
  let structurallyLimited = false;
  let rMultiple = 0;
  let executionInvalid = false;
  let invalidReason: string | undefined;
  // No-chase state — price is too far from the aggression cluster
  let isNoChase = false;
  let isOverheadVacuumShort = false;
  let idealShortEntryZone: ExecutionZone | null = null;
  let idealLongEntryZone: ExecutionZone | null = null;
  let vacuumInvalidationZone: ExecutionZone | null = null;
  // Whether there was no meaningful aggression cluster
  let noAggressionCluster = false;
  let isReclaimEntry = false;
  let reclaimType: "LONG_RECLAIM" | "SHORT_RECLAIM" | null = null;

  const atr = computeATR(klines);

  // Timeframe zone scaling: 15m is slower/cleaner — widen all structural buffers
  const tfScale = timeframe === "15m" ? 1.6 : timeframe === "5m" ? 1.1 : 1.0;

  if (hasCleanEntry) {
    if (entryBias === "LONG") {
      // =======================================================================
      // LONG EXECUTION — entry anchored to bullish aggression cluster
      // SL anchored to vacuum invalidation / cluster support
      // =======================================================================
      const bullishCluster = findAggressionCluster(
        aggressionBubbles,
        "BUY",
        atr,
      );

      if (!bullishCluster || bullishCluster.strength < 8) {
        // No meaningful bullish aggression cluster found
        noAggressionCluster = true;
      } else {
        // Build entry zone around the cluster
        const spread = Math.max(
          bullishCluster.highPrice - bullishCluster.lowPrice,
          atr * 0.2 * tfScale,
        );
        const zoneHalf = Math.max(
          atr * 0.3 * tfScale,
          spread / 2 + atr * 0.1 * tfScale,
        );

        idealLongEntryZone = {
          start: bullishCluster.centerPrice - zoneHalf,
          end: bullishCluster.centerPrice + zoneHalf,
        };

        // NO-CHASE RULE: if price has run too far above the cluster, don't chase
        const noChaseLong =
          currentPrice > bullishCluster.centerPrice + atr * 1.5 * tfScale;

        if (noChaseLong) {
          isNoChase = true;
          // idealLongEntryZone is stored for faint chart reference
        } else {
          entryZone = idealLongEntryZone;

          // SL: below the cluster support with vacuum invalidation buffer
          // Use vacuum lower edge if vacuum is ABOVE (downside invalidation)
          // Otherwise use the cluster bottom as support reference
          const clusterSupport = bullishCluster.lowPrice;
          const slBase =
            vacuumZone.side === "ABOVE" && vacuumZone.startPrice > currentPrice
              ? Math.min(clusterSupport, vacuumZone.startPrice - atr * 0.3)
              : clusterSupport;

          slZone = {
            start: slBase - atr * 0.55 * tfScale,
            end: slBase - atr * 0.05,
          };

          const entryMid = (entryZone.start + entryZone.end) / 2;
          const slMid = (slZone.start + slZone.end) / 2;
          const R = Math.max(entryMid - slMid, entryMid * 0.002);

          // TP1: vacuum midpoint or 1R above entry
          const rawTp1Price =
            vacuumZone.side === "ABOVE" && vacuumZone.startPrice > 0
              ? (vacuumZone.startPrice + vacuumZone.endPrice) / 2
              : entryMid + R;
          const tp1Price = Math.max(
            rawTp1Price,
            entryZone.end + atr * 0.3 * tfScale,
          );
          tp1Zone = {
            start: tp1Price - atr * 0.2 * tfScale,
            end: tp1Price + atr * 0.2 * tfScale,
          };
          rMultiple = (tp1Price - entryMid) / R;

          // TP2: rational 3R target supported by vacuum
          const tp2_3R = entryMid + R * 3;
          const vacuumEnd =
            vacuumZone.side === "ABOVE" && vacuumZone.endPrice > 0
              ? vacuumZone.endPrice
              : 0;

          if (vacuumEnd >= entryMid + R * 2.5) {
            const tp2Price = Math.min(tp2_3R, vacuumEnd);
            if (tp2Price > tp1Price) {
              tp2Zone = {
                start: tp2Price - atr * 0.2 * tfScale,
                end: tp2Price + atr * 0.2 * tfScale,
              };
              rMultiple = (tp2Price - entryMid) / R;
            }
          } else if (vacuumEnd >= entryMid + R * 1.5 && vacuumEnd > tp1Price) {
            tp2Zone = {
              start: vacuumEnd - atr * 0.2 * tfScale,
              end: vacuumEnd + atr * 0.2 * tfScale,
            };
            rMultiple = (vacuumEnd - entryMid) / R;
            structurallyLimited = true;
            if (executionQuality === "HIGH") executionQuality = "MEDIUM";
          } else {
            tp2Zone = null;
            structurallyLimited = true;
            if (executionQuality === "HIGH") executionQuality = "MEDIUM";
          }
        }
      }
    } else {
      // =======================================================================
      // SHORT EXECUTION — entry anchored to bearish aggression cluster
      // SL anchored to vacuum invalidation
      // =======================================================================
      isOverheadVacuumShort =
        vacuumZone.side === "ABOVE" && vacuumZone.startPrice > 0;

      const bearishCluster = findAggressionCluster(
        aggressionBubbles,
        "SELL",
        atr,
      );

      if (!bearishCluster || bearishCluster.strength < 8) {
        // No meaningful bearish aggression cluster found
        noAggressionCluster = true;
      } else {
        // Build entry zone around the cluster
        const spread = Math.max(
          bearishCluster.highPrice - bearishCluster.lowPrice,
          atr * 0.2 * tfScale,
        );
        const zoneHalf = Math.max(
          atr * 0.3 * tfScale,
          spread / 2 + atr * 0.1 * tfScale,
        );

        if (isOverheadVacuumShort) {
          // -------------------------------------------------------------------
          // OVERHEAD VACUUM SHORT
          // Entry: bearish aggression cluster (rejection zone)
          // SL: above vacuum top (overhead vacuum invalidation)
          // -------------------------------------------------------------------
          const clusterEntryZone: ExecutionZone = {
            start: bearishCluster.centerPrice - zoneHalf,
            end: bearishCluster.centerPrice + zoneHalf,
          };

          // Keep ideal entry zone for faint reference
          idealShortEntryZone = clusterEntryZone;

          // SL: above vacuum top + buffer (overhead vacuum invalidation)
          const slBase = vacuumZone.endPrice;
          const computedSlZone: ExecutionZone = {
            start: slBase,
            end: slBase + atr * 0.5 * tfScale,
          };
          vacuumInvalidationZone = computedSlZone;

          // NO-CHASE RULE: if price already extended well below the cluster
          const noChasePriceThreshold =
            bearishCluster.centerPrice - atr * 1.5 * tfScale;
          if (currentPrice < noChasePriceThreshold) {
            isNoChase = true;
          } else {
            entryZone = clusterEntryZone;
            slZone = computedSlZone;

            const entryMid = (entryZone.start + entryZone.end) / 2;
            const slMid = (slZone.start + slZone.end) / 2;
            const R = Math.max(slMid - entryMid, entryMid * 0.002);

            const rawTp1Price = entryMid - R;
            const tp1Price = Math.min(
              rawTp1Price,
              entryZone.start - atr * 0.3 * tfScale,
            );
            tp1Zone = {
              start: tp1Price - atr * 0.2 * tfScale,
              end: tp1Price + atr * 0.2 * tfScale,
            };
            rMultiple = (entryMid - tp1Price) / R;

            const tp2_3R = entryMid - R * 3;
            const tp1Mid = (tp1Zone.start + tp1Zone.end) / 2;
            if (tp2_3R < tp1Mid) {
              tp2Zone = {
                start: tp2_3R - atr * 0.2 * tfScale,
                end: tp2_3R + atr * 0.2 * tfScale,
              };
              rMultiple = (entryMid - tp2_3R) / R;
            } else {
              structurallyLimited = true;
              if (executionQuality === "HIGH") executionQuality = "MEDIUM";
            }
          }
        } else {
          // -------------------------------------------------------------------
          // STANDARD SHORT (vacuum below or none)
          // Entry: bearish aggression cluster
          // SL: above the cluster top with buffer
          // -------------------------------------------------------------------
          const clusterEntryZone: ExecutionZone = {
            start: bearishCluster.centerPrice - zoneHalf,
            end: bearishCluster.centerPrice + zoneHalf,
          };
          idealShortEntryZone = clusterEntryZone;

          // NO-CHASE RULE: if price already dumped far below the cluster
          const noChaseShort =
            currentPrice < bearishCluster.centerPrice - atr * 1.5 * tfScale;

          if (noChaseShort) {
            isNoChase = true;
          } else {
            entryZone = clusterEntryZone;

            // SL: above the cluster top with ATR buffer (cluster resistance becomes invalidation)
            const slBase = bearishCluster.highPrice;
            slZone = {
              start: slBase + atr * 0.05,
              end: slBase + atr * 0.55 * tfScale,
            };

            const entryMid = (entryZone.start + entryZone.end) / 2;
            const slMid = (slZone.start + slZone.end) / 2;
            const R = Math.max(slMid - entryMid, entryMid * 0.002);

            // TP1: vacuum midpoint or 1R below entry
            const rawTp1Price =
              vacuumZone.side === "BELOW" && vacuumZone.startPrice > 0
                ? (vacuumZone.startPrice + vacuumZone.endPrice) / 2
                : entryMid - R;
            const tp1Price = Math.min(
              rawTp1Price,
              entryZone.start - atr * 0.3 * tfScale,
            );
            tp1Zone = {
              start: tp1Price - atr * 0.2 * tfScale,
              end: tp1Price + atr * 0.2 * tfScale,
            };
            rMultiple = (entryMid - tp1Price) / R;

            // TP2: rational 3R target
            const tp2_3R = entryMid - R * 3;
            const vacuumEnd =
              vacuumZone.side === "BELOW" && vacuumZone.endPrice > 0
                ? vacuumZone.endPrice
                : 0;

            if (vacuumEnd > 0 && vacuumEnd <= entryMid - R * 2.5) {
              const tp2Price = Math.max(tp2_3R, vacuumEnd);
              if (tp2Price < tp1Price) {
                tp2Zone = {
                  start: tp2Price - atr * 0.2 * tfScale,
                  end: tp2Price + atr * 0.2 * tfScale,
                };
                rMultiple = (entryMid - tp2Price) / R;
              }
            } else if (
              vacuumEnd > 0 &&
              vacuumEnd <= entryMid - R * 1.5 &&
              vacuumEnd < tp1Price
            ) {
              tp2Zone = {
                start: vacuumEnd - atr * 0.2 * tfScale,
                end: vacuumEnd + atr * 0.2 * tfScale,
              };
              rMultiple = (entryMid - vacuumEnd) / R;
              structurallyLimited = true;
              if (executionQuality === "HIGH") executionQuality = "MEDIUM";
            } else {
              tp2Zone = null;
              structurallyLimited = true;
              if (executionQuality === "HIGH") executionQuality = "MEDIUM";
            }
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // STRICT DIRECTIONAL VALIDATION (only for active execution zones)
    // Skip if in no-chase state or no aggression cluster
    // -----------------------------------------------------------------------
    if (!isNoChase && !noAggressionCluster && entryZone && slZone && tp1Zone) {
      const validationError = validateExecutionZones(
        entryBias,
        entryZone,
        slZone,
        tp1Zone,
        tp2Zone,
      );
      if (validationError !== null) {
        executionInvalid = true;
        invalidReason = validationError;
        entryZone = null;
        slZone = null;
        tp1Zone = null;
        tp2Zone = null;
        if (executionQuality === "HIGH" || executionQuality === "MEDIUM") {
          executionQuality = "LOW";
        }
        rMultiple = 0;
        structurallyLimited = false;
      }
    }

    // Hard minimum reward validation — TP1 must be >= 1.0R
    const MIN_TP1_R = 1.0;
    if (
      !isNoChase &&
      !noAggressionCluster &&
      !executionInvalid &&
      tp1Zone &&
      entryZone &&
      slZone
    ) {
      const entryMid2 = (entryZone.start + entryZone.end) / 2;
      const slMid2 = (slZone.start + slZone.end) / 2;
      const R2 =
        entryBias === "LONG"
          ? Math.max(entryMid2 - slMid2, entryMid2 * 0.002)
          : Math.max(slMid2 - entryMid2, entryMid2 * 0.002);
      const tp1Mid2 = (tp1Zone.start + tp1Zone.end) / 2;
      const tp1R =
        entryBias === "LONG"
          ? (tp1Mid2 - entryMid2) / R2
          : (entryMid2 - tp1Mid2) / R2;

      if (tp1R < MIN_TP1_R) {
        executionInvalid = true;
        invalidReason =
          tp1R < 0.5
            ? "Reward path too small for execution"
            : "TP1 below minimum 1R threshold";
        entryZone = null;
        slZone = null;
        tp1Zone = null;
        tp2Zone = null;
        rMultiple = 0;
        structurallyLimited = false;
        if (executionQuality !== "LOW") executionQuality = "LOW";
      }
    }
  }

  // ---------------------------------------------------------------------------
  // RECLAIM DETECTION — second execution model
  // Runs after continuation logic. Activates only when no valid continuation
  // entry zone was produced.
  // ---------------------------------------------------------------------------
  if (!entryZone && !isNoChase && aggressionBubbles.length > 0) {
    const reclaimSetup = computeReclaimSetup(
      aggressionBubbles,
      currentPrice,
      atr,
      upperStructure,
      lowerStructure,
      entryBias,
      pressure,
      pressureTrend,
      rangePosition,
      tfScale,
    );

    if (reclaimSetup) {
      isReclaimEntry = true;
      reclaimType = reclaimSetup.type;

      if (reclaimSetup.isExtended) {
        // Price too far from reclaim zone — store ideal zone for reference only
        if (reclaimSetup.type === "LONG_RECLAIM") {
          idealLongEntryZone = reclaimSetup.entryZone;
          vacuumInvalidationZone = reclaimSetup.slZone;
        } else {
          idealShortEntryZone = reclaimSetup.entryZone;
          vacuumInvalidationZone = reclaimSetup.slZone;
        }
      } else {
        // Valid reclaim entry — compute TP from range/structure
        const reclaimEntry = reclaimSetup.entryZone;
        const reclaimSl = reclaimSetup.slZone;
        const entryMidR = (reclaimEntry.start + reclaimEntry.end) / 2;
        const slMidR = (reclaimSl.start + reclaimSl.end) / 2;

        const isLongReclaim = reclaimSetup.type === "LONG_RECLAIM";
        const R = isLongReclaim
          ? Math.max(entryMidR - slMidR, entryMidR * 0.002)
          : Math.max(slMidR - entryMidR, entryMidR * 0.002);

        // TP logic: range-based — use structure boundaries, not vacuum
        const isOutsideRangeLong =
          isLongReclaim && currentPrice > upperStructure;
        const isOutsideRangeShort =
          !isLongReclaim && currentPrice < lowerStructure;
        const rangeSize = Math.max(upperStructure - lowerStructure, atr * 3);

        let reclaimTp1: ExecutionZone | null = null;
        let reclaimTp2: ExecutionZone | null = null;
        let reclaimR = 0;

        if (isLongReclaim) {
          const tp1Raw = isOutsideRangeLong
            ? upperStructure + rangeSize * 0.3
            : upperStructure;
          const tp1Price = Math.max(tp1Raw, reclaimEntry.end + atr * 0.3);
          reclaimTp1 = {
            start: tp1Price - atr * 0.2 * tfScale,
            end: tp1Price + atr * 0.2 * tfScale,
          };
          reclaimR = (tp1Price - entryMidR) / R;

          const tp2Raw = isOutsideRangeLong
            ? upperStructure + rangeSize * 0.618
            : upperStructure + rangeSize * 0.25;
          if (tp2Raw > tp1Price + atr * 0.3 * tfScale) {
            reclaimTp2 = {
              start: tp2Raw - atr * 0.2 * tfScale,
              end: tp2Raw + atr * 0.2 * tfScale,
            };
            reclaimR = (tp2Raw - entryMidR) / R;
          }
        } else {
          const tp1Raw = isOutsideRangeShort
            ? lowerStructure - rangeSize * 0.3
            : lowerStructure;
          const tp1Price = Math.min(tp1Raw, reclaimEntry.start - atr * 0.3);
          reclaimTp1 = {
            start: tp1Price - atr * 0.2 * tfScale,
            end: tp1Price + atr * 0.2 * tfScale,
          };
          reclaimR = (entryMidR - tp1Price) / R;

          const tp2Raw = isOutsideRangeShort
            ? lowerStructure - rangeSize * 0.618
            : lowerStructure - rangeSize * 0.25;
          if (tp2Raw < tp1Price - atr * 0.3 * tfScale) {
            reclaimTp2 = {
              start: tp2Raw - atr * 0.2 * tfScale,
              end: tp2Raw + atr * 0.2 * tfScale,
            };
            reclaimR = (entryMidR - tp2Raw) / R;
          }
        }

        // Validate before accepting
        const reclaimBias: EntryBias = isLongReclaim ? "LONG" : "SHORT";
        const reclaimValidErr = reclaimTp1
          ? validateExecutionZones(
              reclaimBias,
              reclaimEntry,
              reclaimSl,
              reclaimTp1,
              reclaimTp2,
            )
          : "No TP zone";

        // Also check 1R minimum
        const tp1MidR = reclaimTp1
          ? (reclaimTp1.start + reclaimTp1.end) / 2
          : 0;
        const tp1RValue = reclaimTp1
          ? isLongReclaim
            ? (tp1MidR - entryMidR) / R
            : (entryMidR - tp1MidR) / R
          : 0;

        if (reclaimValidErr === null && tp1RValue >= 1.0 && reclaimTp1) {
          entryZone = reclaimEntry;
          slZone = reclaimSl;
          tp1Zone = reclaimTp1;
          tp2Zone = reclaimTp2;
          rMultiple = reclaimR;
          executionQuality = reclaimSetup.quality;
          entryBias = reclaimBias;
        } else {
          // Reclaim exists but zones didn't pass validation — mark extended/wait
          isReclaimEntry = true;
          if (reclaimSetup.type === "LONG_RECLAIM") {
            idealLongEntryZone = reclaimSetup.entryZone;
          } else {
            idealShortEntryZone = reclaimSetup.entryZone;
          }
          // Clear the failed zone attempt
          entryZone = null;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // EXECUTION VALIDITY STATE RESOLUTION
  // Priority: reclaim-wait > no-chase > no-cluster > invalid > reclaim-valid > valid > neutral
  // ---------------------------------------------------------------------------
  let executionValidityState: string;
  if (isReclaimEntry && reclaimType === "LONG_RECLAIM" && !entryZone) {
    executionValidityState = "RECLAIM_LONG_WAIT_RETEST";
  } else if (isReclaimEntry && reclaimType === "SHORT_RECLAIM" && !entryZone) {
    executionValidityState = "RECLAIM_SHORT_WAIT_RETEST";
  } else if (
    isReclaimEntry &&
    reclaimType === "LONG_RECLAIM" &&
    entryZone !== null
  ) {
    executionValidityState = "RECLAIM_LONG";
  } else if (
    isReclaimEntry &&
    reclaimType === "SHORT_RECLAIM" &&
    entryZone !== null
  ) {
    executionValidityState = "RECLAIM_SHORT";
  } else if (noAggressionCluster && entryBias === "LONG") {
    executionValidityState = "LONG_NO_AGGRESSION_CLUSTER";
  } else if (noAggressionCluster && entryBias === "SHORT") {
    executionValidityState = "SHORT_NO_AGGRESSION_CLUSTER";
  } else if (isNoChase && entryBias === "LONG") {
    executionValidityState = "LONG_BIAS_NO_CLEAN_ENTRY";
  } else if (isNoChase && entryBias === "SHORT") {
    executionValidityState = "SHORT_BIAS_NO_CLEAN_ENTRY";
  } else if (!executionInvalid && entryBias === "LONG" && entryZone !== null) {
    executionValidityState = "VALID_LONG";
  } else if (!executionInvalid && entryBias === "SHORT" && entryZone !== null) {
    executionValidityState = "VALID_SHORT";
  } else if (executionInvalid && entryBias === "LONG") {
    executionValidityState = "LONG_BIAS_NO_EXEC";
  } else if (executionInvalid && entryBias === "SHORT") {
    executionValidityState = "SHORT_BIAS_NO_EXEC";
  } else {
    executionValidityState = "NEUTRAL_LOW";
  }

  // ---------------------------------------------------------------------------
  // INTERPRETATION LINE — aggression-anchored language
  // ---------------------------------------------------------------------------
  let interpretationLine: string;
  if (executionValidityState === "RECLAIM_LONG") {
    if (executionQuality === "HIGH") {
      interpretationLine =
        "Failed seller aggression reclaimed — long setup active, invalidation below failed zone";
    } else {
      interpretationLine =
        "Reclaim confirmed above failed bearish aggression — long entry near reclaimed zone";
    }
  } else if (executionValidityState === "RECLAIM_SHORT") {
    if (executionQuality === "HIGH") {
      interpretationLine =
        "Failed buyer aggression lost — short setup active, invalidation above failed zone";
    } else {
      interpretationLine =
        "Reclaim confirmed below failed bullish aggression — short entry near reclaimed zone";
    }
  } else if (executionValidityState === "RECLAIM_LONG_WAIT_RETEST") {
    interpretationLine =
      "Price extended beyond reclaim zone — wait for retest to failed aggression zone";
  } else if (executionValidityState === "RECLAIM_SHORT_WAIT_RETEST") {
    interpretationLine =
      "Price extended below failed aggression zone — wait for retest back to reclaim level";
  } else if (
    executionValidityState === "LONG_NO_AGGRESSION_CLUSTER" ||
    executionValidityState === "SHORT_NO_AGGRESSION_CLUSTER"
  ) {
    interpretationLine =
      "No clean aggression cluster detected — directional bias exists but no entry zone";
  } else if (executionValidityState === "LONG_BIAS_NO_CLEAN_ENTRY") {
    interpretationLine =
      "Directional bias valid, but price is too far from the bullish aggression zone — wait for re-entry";
  } else if (executionValidityState === "SHORT_BIAS_NO_CLEAN_ENTRY") {
    if (isOverheadVacuumShort) {
      interpretationLine =
        "Overhead vacuum supports short bias, but price too far from aggression zone — wait for retest";
    } else {
      interpretationLine =
        "Price already extended below bearish aggression zone — short bias intact, wait for re-entry";
    }
  } else if (executionValidityState === "LONG_BIAS_NO_EXEC") {
    interpretationLine = invalidReason
      ? `Long bias via aggression cluster — ${invalidReason}`
      : "Long bias via aggression exists, but no valid reward path";
  } else if (executionValidityState === "SHORT_BIAS_NO_EXEC") {
    interpretationLine = invalidReason
      ? `Short bias via aggression cluster — ${invalidReason}`
      : "Short bias via aggression exists, but structure does not support execution";
  } else if (executionValidityState === "VALID_LONG") {
    if (structurallyLimited) {
      interpretationLine = `Long entry supported by bullish aggression cluster — structure limits path (~${rMultiple.toFixed(1)}R)`;
    } else if (executionQuality === "HIGH") {
      interpretationLine =
        "Long entry supported by bullish aggression cluster — aggression confirms continuation, vacuum defines path";
    } else {
      interpretationLine =
        "Long entry anchored to bullish aggression cluster — vacuum and pressure mostly aligned";
    }
  } else if (executionValidityState === "VALID_SHORT") {
    if (isOverheadVacuumShort) {
      interpretationLine =
        "Short entry supported by bearish aggression cluster — vacuum defines invalidation above";
    } else if (structurallyLimited) {
      interpretationLine = `Short entry supported by bearish aggression cluster — structure limits path (~${rMultiple.toFixed(1)}R)`;
    } else if (executionQuality === "HIGH") {
      interpretationLine =
        "Short entry supported by bearish aggression cluster — aggression confirms continuation, vacuum defines invalidation";
    } else {
      interpretationLine =
        "Short entry anchored to bearish aggression cluster — vacuum and pressure mostly aligned";
    }
  } else if (directionalState === "CONFLICT") {
    interpretationLine =
      "Directional alignment is present, but no clean execution setup";
  } else if (rangePosition === "MID") {
    interpretationLine = "Mid-range structure — no clean execution path yet";
  } else {
    interpretationLine =
      "Range context and pressure conflict — weak execution quality";
  }

  return {
    rangePosition,
    rangeValue,
    entryBias,
    executionQuality,
    entryZone,
    slZone,
    tp1Zone,
    tp2Zone,
    interpretationLine,
    alignmentScore,
    hasCleanEntry: entryZone !== null,
    structurallyLimited,
    rMultiple,
    executionInvalid,
    invalidReason,
    directionalState,
    executionValidityState,
    isNoChase,
    isOverheadVacuumShort,
    idealShortEntryZone,
    idealLongEntryZone,
    vacuumInvalidationZone,
    noAggressionCluster,
    isReclaimEntry,
    reclaimType,
  };
}
