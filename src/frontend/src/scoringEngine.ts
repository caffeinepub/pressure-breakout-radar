import type {
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

/**
 * Validates the computed execution zones for directional and mathematical
 * consistency. Returns null if valid, or a string reason if invalid.
 *
 * LONG rules:
 *   - SL must be below entry (positive R)
 *   - TP1 mid must be strictly above entry zone top
 *   - TP2 mid (if present) must be strictly above TP1 mid
 *
 * SHORT rules:
 *   - SL must be above entry (positive R)
 *   - TP1 mid must be strictly below entry zone bottom
 *   - TP2 mid (if present) must be strictly below TP1 mid
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
    // SL must be below entry mid — positive R required
    if (slMid >= entryMid) {
      return "NO VALID LONG REWARD PATH";
    }
    // TP1 must be above the entry zone top (not just entry mid)
    if (tp1Mid <= entryZone.end) {
      return "INVALID LONG EXECUTION";
    }
    // TP2 (if present) must be above TP1
    if (tp2Zone !== null) {
      const tp2Mid = (tp2Zone.start + tp2Zone.end) / 2;
      if (tp2Mid <= tp1Mid) {
        return "INVALID LONG EXECUTION";
      }
    }
  } else if (bias === "SHORT") {
    // SL must be above entry mid — positive R required
    if (slMid <= entryMid) {
      return "NO VALID SHORT REWARD PATH";
    }
    // TP1 must be below the entry zone bottom (not just entry mid)
    if (tp1Mid >= entryZone.start) {
      return "INVALID SHORT EXECUTION";
    }
    // TP2 (if present) must be below TP1
    if (tp2Zone !== null) {
      const tp2Mid = (tp2Zone.start + tp2Zone.end) / 2;
      if (tp2Mid >= tp1Mid) {
        return "INVALID SHORT EXECUTION";
      }
    }
  }

  return null; // valid
}

export function computeExecutionContext(
  klines: Kline[],
  currentPrice: number,
  breakoutContext: BreakoutContext,
  vacuumZone: VacuumZone,
  pressure: PressureResult,
  pressureTrend: TrendDirection,
  tensionTrend: TrendDirection,
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
    vacuumZone.side === "BELOW",
    rangePosition === "LOWER",
    pressure.side === "DOWN",
    pressureTrend === "RISING",
    tensionTrend === "RISING",
  ];
  const longScore = longSignals.filter(Boolean).length;
  const shortScore = shortSignals.filter(Boolean).length;

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

  // Base quality from alignment signals
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

  if (hasCleanEntry) {
    const atr = computeATR(klines);
    const zoneHalfWidth = Math.max(atr * 0.35, currentPrice * 0.0008);
    const recent20 = klines.slice(-20);

    if (entryBias === "LONG") {
      entryZone = {
        start: upperStructure - zoneHalfWidth * 0.4,
        end: upperStructure + zoneHalfWidth * 1.2,
      };
      const localLow = Math.min(...recent20.map((k) => k.low));
      slZone = { start: localLow - atr * 0.25, end: localLow + atr * 0.15 };
      const entryMid = (entryZone.start + entryZone.end) / 2;
      const slMid = (slZone.start + slZone.end) / 2;
      const R = Math.max(entryMid - slMid, entryMid * 0.002);

      // TP1: vacuum midpoint or 1R above entry
      const rawTp1Price =
        vacuumZone.side === "ABOVE" && vacuumZone.startPrice > 0
          ? (vacuumZone.startPrice + vacuumZone.endPrice) / 2
          : entryMid + R;
      // Ensure TP1 is always above entry zone top for a valid LONG
      const tp1Price = Math.max(rawTp1Price, entryZone.end + atr * 0.3);
      tp1Zone = { start: tp1Price - atr * 0.2, end: tp1Price + atr * 0.2 };
      rMultiple = (tp1Price - entryMid) / R;

      // TP2: 1:3 rational model — null if structure doesn't support it
      const tp2_3R = entryMid + R * 3;
      const vacuumEnd =
        vacuumZone.side === "ABOVE" && vacuumZone.endPrice > 0
          ? vacuumZone.endPrice
          : 0;

      if (vacuumEnd >= entryMid + R * 2.5) {
        const tp2Price = Math.min(tp2_3R, vacuumEnd);
        // TP2 must be above TP1
        if (tp2Price > tp1Price) {
          tp2Zone = { start: tp2Price - atr * 0.2, end: tp2Price + atr * 0.2 };
          rMultiple = (tp2Price - entryMid) / R;
        }
      } else if (vacuumEnd >= entryMid + R * 1.5 && vacuumEnd > tp1Price) {
        tp2Zone = { start: vacuumEnd - atr * 0.2, end: vacuumEnd + atr * 0.2 };
        rMultiple = (vacuumEnd - entryMid) / R;
        structurallyLimited = true;
        if (executionQuality === "HIGH") executionQuality = "MEDIUM";
      } else {
        tp2Zone = null;
        structurallyLimited = true;
        if (executionQuality === "HIGH") executionQuality = "MEDIUM";
      }
    } else {
      // SHORT
      entryZone = {
        start: lowerStructure - zoneHalfWidth * 1.2,
        end: lowerStructure + zoneHalfWidth * 0.4,
      };
      const localHigh = Math.max(...recent20.map((k) => k.high));
      slZone = { start: localHigh - atr * 0.15, end: localHigh + atr * 0.25 };
      const entryMid = (entryZone.start + entryZone.end) / 2;
      const slMid = (slZone.start + slZone.end) / 2;
      const R = Math.max(slMid - entryMid, entryMid * 0.002);

      // TP1: vacuum midpoint or 1R below entry
      const rawTp1Price =
        vacuumZone.side === "BELOW" && vacuumZone.startPrice > 0
          ? (vacuumZone.startPrice + vacuumZone.endPrice) / 2
          : entryMid - R;
      // Ensure TP1 is always below entry zone bottom for a valid SHORT
      const tp1Price = Math.min(rawTp1Price, entryZone.start - atr * 0.3);
      tp1Zone = { start: tp1Price - atr * 0.2, end: tp1Price + atr * 0.2 };
      rMultiple = (entryMid - tp1Price) / R;

      // TP2: 1:3 rational model — null if structure doesn't support it
      const tp2_3R = entryMid - R * 3;
      const vacuumEnd =
        vacuumZone.side === "BELOW" && vacuumZone.endPrice > 0
          ? vacuumZone.endPrice
          : 0;

      if (vacuumEnd > 0 && vacuumEnd <= entryMid - R * 2.5) {
        const tp2Price = Math.max(tp2_3R, vacuumEnd);
        // TP2 must be below TP1
        if (tp2Price < tp1Price) {
          tp2Zone = { start: tp2Price - atr * 0.2, end: tp2Price + atr * 0.2 };
          rMultiple = (entryMid - tp2Price) / R;
        }
      } else if (
        vacuumEnd > 0 &&
        vacuumEnd <= entryMid - R * 1.5 &&
        vacuumEnd < tp1Price
      ) {
        tp2Zone = { start: vacuumEnd - atr * 0.2, end: vacuumEnd + atr * 0.2 };
        rMultiple = (entryMid - vacuumEnd) / R;
        structurallyLimited = true;
        if (executionQuality === "HIGH") executionQuality = "MEDIUM";
      } else {
        tp2Zone = null;
        structurallyLimited = true;
        if (executionQuality === "HIGH") executionQuality = "MEDIUM";
      }
    }

    // -----------------------------------------------------------------------
    // STRICT DIRECTIONAL VALIDATION
    // After computing all zones, verify they are mathematically consistent.
    // A setup may be directionally aligned but still invalid for execution.
    // If invalid: null all zones, mark executionInvalid, downgrade quality.
    // -----------------------------------------------------------------------
    if (entryZone && slZone && tp1Zone) {
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
        // Do NOT draw contradictory overlay zones on the chart
        entryZone = null;
        slZone = null;
        tp1Zone = null;
        tp2Zone = null;
        // Downgrade quality aggressively
        if (executionQuality === "HIGH" || executionQuality === "MEDIUM") {
          executionQuality = "LOW";
        }
        rMultiple = 0;
        structurallyLimited = false;
      }
    }
  }

  // Interpretation line — respects invalid state
  let interpretationLine: string;
  if (executionInvalid && invalidReason) {
    interpretationLine = `${invalidReason} — alignment present but structure fails execution math`;
  } else if (structurallyLimited && hasCleanEntry) {
    const rmStr = rMultiple.toFixed(1);
    if (entryBias === "LONG") {
      interpretationLine = `Long leaning — structure limits reward path (~${rmStr}R achievable)`;
    } else {
      interpretationLine = `Short leaning — structure limits reward path (~${rmStr}R achievable)`;
    }
  } else if (executionQuality === "HIGH" && entryBias === "LONG") {
    interpretationLine =
      "Long setup supported by upper-range pressure and vacuum above";
  } else if (executionQuality === "HIGH" && entryBias === "SHORT") {
    interpretationLine =
      "Short setup supported by lower-range pressure and vacuum below";
  } else if (executionQuality === "MEDIUM" && entryBias === "LONG") {
    interpretationLine = "Long leaning — structure and pressure mostly aligned";
  } else if (executionQuality === "MEDIUM" && entryBias === "SHORT") {
    interpretationLine =
      "Short leaning — structure and pressure mostly aligned";
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
    hasCleanEntry,
    structurallyLimited,
    rMultiple,
    executionInvalid,
    invalidReason,
  };
}
