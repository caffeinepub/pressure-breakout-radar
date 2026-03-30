/**
 * threeTFGate.ts
 *
 * Lightweight 3-timeframe quality gate for Top 10 pre-candidates.
 *
 * Flow:
 *   1m discovery → top 20 pre-candidates → 5m/15m gate → final Top 10
 *
 * Design rules:
 * - Never run full scoringEngine on 5m/15m here
 * - Only lightweight deterministic rules
 * - Fetch last 20 candles per symbol per timeframe
 * - Re-run every slow scan cycle, not inside the fast render loop
 */

import { fetchKlinesBatch } from "./binanceApi";
import type { Candidate, Kline } from "./types";

export type LightBias = "LONG" | "SHORT" | "NEUTRAL";
export type RangeContext15m = "UPPER_RANGE" | "MID_RANGE" | "LOWER_RANGE";
export type ContextVerdict15m = "SUPPORTIVE" | "NEUTRAL" | "HOSTILE";
export type TfAlignment = "3TF_ALIGNED" | "5M_CONFIRMED";

export interface Lightweight5mResult {
  /** Directional bias from close location + recent candle structure */
  bias: LightBias;
  /** Direction component of the body/range pressure proxy */
  pressureDirection: LightBias;
  /** Magnitude of pressure proxy 0–100 */
  pressureProxy: number;
  /** Compact breakout quality proxy 0–100 */
  breakoutScoreProxy: number;
}

export interface Lightweight15mResult {
  bias: LightBias;
  biasStrength: number; // 0–100
  rangeContext: RangeContext15m;
  contextVerdict: ContextVerdict15m;
  /** contextSupport mapped to score: 100 | 60 | 0 */
  contextSupport: number;
}

export interface GatedCandidate extends Omit<Candidate, "rank"> {
  top10QualityScore: number;
  tfAlignment: TfAlignment;
  contextSupport15m: number;
}

// ─── LIGHTWEIGHT 5M COMPUTATION ─────────────────────────────────────────────

/**
 * Compute lightweight 5m bias, pressure proxy, and breakout quality proxy.
 * Uses last 20 candles only. No heavy architecture.
 */
export function computeLightweight5m(klines: Kline[]): Lightweight5mResult {
  if (klines.length < 5) {
    return {
      bias: "NEUTRAL",
      pressureDirection: "NEUTRAL",
      pressureProxy: 0,
      breakoutScoreProxy: 0,
    };
  }

  const n = Math.min(20, klines.length);
  const recent = klines.slice(-n);

  const high20 = Math.max(...recent.map((k) => k.high));
  const low20 = Math.min(...recent.map((k) => k.low));
  const range20 = high20 - low20;
  const close = recent[recent.length - 1].close;

  // ── Bias: close position in 20-candle range ──────────────────────────────
  const pos = range20 > 0 ? (close - low20) / range20 : 0.5;
  let bias: LightBias = "NEUTRAL";
  if (pos > 0.6) bias = "LONG";
  else if (pos < 0.4) bias = "SHORT";

  // Refine with last 5 candle directional count
  const last5 = recent.slice(-5);
  const bull5 = last5.filter((k) => k.close >= k.open).length;
  if (bull5 >= 4) {
    bias = "LONG";
  } else if (bull5 <= 1) {
    bias = "SHORT";
  } else if (bull5 >= 3 && pos >= 0.5) {
    bias = "LONG";
  } else if (bull5 <= 2 && pos <= 0.5) {
    bias = "SHORT";
  }

  // ── Pressure proxy: directional body/range over last 10 candles ──────────
  const last10 = recent.slice(-10);
  let dirSum = 0;
  for (const k of last10) {
    const body = Math.abs(k.close - k.open);
    const r = k.high - k.low;
    const ratio = r > 0 ? body / r : 0;
    dirSum += k.close >= k.open ? ratio : -ratio;
  }
  const pressureDirection: LightBias =
    dirSum > 0.1 ? "LONG" : dirSum < -0.1 ? "SHORT" : "NEUTRAL";
  const pressureProxy = Math.min(
    100,
    (Math.abs(dirSum) / Math.max(1, last10.length)) * 200,
  );

  // ── Breakout score proxy ──────────────────────────────────────────────────
  // Direction consistency of last 10 candles
  const bull10 = last10.filter((k) => k.close >= k.open).length;
  const majorityCount = Math.max(bull10, 10 - bull10);
  const dirConsistency = (majorityCount / 10) * 100;

  // Close location score (favours direction)
  const closeScore = bias === "SHORT" ? (1 - pos) * 100 : pos * 100;

  // Continuation: last 3 candles going same way
  const last3 = recent.slice(-3);
  const bull3 = last3.filter((k) => k.close >= k.open).length;
  const continuationScore =
    bias === "LONG"
      ? (bull3 / 3) * 100
      : bias === "SHORT"
        ? ((3 - bull3) / 3) * 100
        : 50;

  const breakoutScoreProxy =
    dirConsistency * 0.4 + closeScore * 0.35 + continuationScore * 0.25;

  return { bias, pressureDirection, pressureProxy, breakoutScoreProxy };
}

// ─── LIGHTWEIGHT 15M COMPUTATION ─────────────────────────────────────────────

/**
 * Compute lightweight 15m structural context.
 * Returns a contextVerdict (SUPPORTIVE/NEUTRAL/HOSTILE) relative to the
 * candidate's intended direction.
 */
export function computeLightweight15m(
  klines: Kline[],
  candidateDirection: LightBias,
): Lightweight15mResult {
  if (klines.length < 5) {
    return {
      bias: "NEUTRAL",
      biasStrength: 0,
      rangeContext: "MID_RANGE",
      contextVerdict: "NEUTRAL",
      contextSupport: 60,
    };
  }

  const n = Math.min(20, klines.length);
  const recent = klines.slice(-n);

  const high20 = Math.max(...recent.map((k) => k.high));
  const low20 = Math.min(...recent.map((k) => k.low));
  const range20 = high20 - low20;
  const close = recent[recent.length - 1].close;
  const pos = range20 > 0 ? (close - low20) / range20 : 0.5;

  // ── Structural bias from close position + candle directional ratio ────────
  const bullCount = recent.filter((k) => k.close >= k.open).length;
  const bullRatio = bullCount / recent.length;

  let bias: LightBias = "NEUTRAL";
  let biasStrength = 0;

  if (pos > 0.65 && bullRatio > 0.55) {
    bias = "LONG";
    biasStrength = Math.min(100, (pos - 0.5) * 150 + bullRatio * 50);
  } else if (pos < 0.35 && bullRatio < 0.45) {
    bias = "SHORT";
    biasStrength = Math.min(100, (0.5 - pos) * 150 + (1 - bullRatio) * 50);
  } else {
    bias = "NEUTRAL";
    biasStrength = 30;
  }

  // ── Range context ─────────────────────────────────────────────────────────
  let rangeContext: RangeContext15m = "MID_RANGE";
  if (pos > 0.65) rangeContext = "UPPER_RANGE";
  else if (pos < 0.35) rangeContext = "LOWER_RANGE";

  // ── Context verdict relative to candidate direction ───────────────────────
  let contextVerdict: ContextVerdict15m = "NEUTRAL";
  let contextSupport = 60;

  if (candidateDirection === "LONG") {
    if (bias === "SHORT" && biasStrength > 40) {
      // 15m showing strong bearish structure — hostile to LONG
      contextVerdict = "HOSTILE";
      contextSupport = 0;
    } else if (
      bias === "LONG" ||
      (bias === "NEUTRAL" && rangeContext !== "UPPER_RANGE")
    ) {
      // 15m supporting long, or neutral with room to go up
      contextVerdict = "SUPPORTIVE";
      contextSupport = 100;
    } else {
      contextVerdict = "NEUTRAL";
      contextSupport = 60;
    }
  } else if (candidateDirection === "SHORT") {
    if (bias === "LONG" && biasStrength > 40) {
      // 15m showing strong bullish structure — hostile to SHORT
      contextVerdict = "HOSTILE";
      contextSupport = 0;
    } else if (
      bias === "SHORT" ||
      (bias === "NEUTRAL" && rangeContext !== "LOWER_RANGE")
    ) {
      // 15m supporting short, or neutral with room to go down
      contextVerdict = "SUPPORTIVE";
      contextSupport = 100;
    } else {
      contextVerdict = "NEUTRAL";
      contextSupport = 60;
    }
  } else {
    // NEUTRAL candidate direction — treat as acceptable
    contextVerdict = "NEUTRAL";
    contextSupport = 60;
  }

  return { bias, biasStrength, rangeContext, contextVerdict, contextSupport };
}

// ─── 5M CONTRADICTION CHECK ──────────────────────────────────────────────────

/**
 * Returns true if the 5m data clearly contradicts the candidate direction.
 * Hard contradiction filter — if 5m strongly opposes 1m, reject.
 */
function is5mContradictory(
  result: Lightweight5mResult,
  direction: LightBias,
): boolean {
  if (direction === "LONG") {
    // Clearly bearish 5m bias — reject
    if (result.bias === "SHORT") return true;
    // Neutral bias but pressure strongly pushing short — reject
    if (
      result.bias === "NEUTRAL" &&
      result.pressureDirection === "SHORT" &&
      result.pressureProxy >= 60
    )
      return true;
    return false;
  }
  if (direction === "SHORT") {
    if (result.bias === "LONG") return true;
    if (
      result.bias === "NEUTRAL" &&
      result.pressureDirection === "LONG" &&
      result.pressureProxy >= 60
    )
      return true;
    return false;
  }
  return false;
}

// ─── MAIN GATE FUNCTION ───────────────────────────────────────────────────────

/**
 * Run the 3TF quality gate on a pre-filtered list of top-20 1m pre-candidates.
 *
 * Fetches 5m + 15m klines for all symbols in parallel (one batch each).
 * Applies 5m contradiction filter and 15m hostility filter.
 * Computes Top10QualityScore for passing candidates.
 *
 * Returns gated candidates sorted by Top10QualityScore descending.
 * Empty array if all candidates fail — caller decides fallback.
 */
export async function runThreeTFGate(
  preCandidates: Omit<Candidate, "rank">[],
): Promise<GatedCandidate[]> {
  if (preCandidates.length === 0) return [];

  const symbols = preCandidates.map((c) => c.symbol);

  // Fetch 5m and 15m klines in parallel
  // batchSize = symbols.length so all run in one parallel batch
  let klines5mMap: Map<string, Kline[]>;
  let klines15mMap: Map<string, Kline[]>;
  try {
    [klines5mMap, klines15mMap] = await Promise.all([
      fetchKlinesBatch(symbols, "5m", 20, symbols.length),
      fetchKlinesBatch(symbols, "15m", 20, symbols.length),
    ]);
  } catch (err) {
    console.warn("[3TF gate] kline fetch failed:", err);
    return [];
  }

  const gated: GatedCandidate[] = [];

  for (const candidate of preCandidates) {
    // Derive 1m candidate direction from pressure side
    const direction: LightBias =
      candidate.pressure.side === "UP"
        ? "LONG"
        : candidate.pressure.side === "DOWN"
          ? "SHORT"
          : "NEUTRAL";

    // Skip NEUTRAL direction — 1m bias is not clear
    if (direction === "NEUTRAL") continue;

    // ── 5m gate ─────────────────────────────────────────────────────────────
    const raw5m = klines5mMap.get(candidate.symbol);
    const result5m =
      raw5m && raw5m.length >= 5
        ? computeLightweight5m(raw5m)
        : {
            bias: "NEUTRAL" as LightBias,
            pressureDirection: "NEUTRAL" as LightBias,
            pressureProxy: 0,
            breakoutScoreProxy: 0,
          };

    if (is5mContradictory(result5m, direction)) continue; // 5m gate reject

    // ── 15m gate ────────────────────────────────────────────────────────────
    const raw15m = klines15mMap.get(candidate.symbol);
    const result15m =
      raw15m && raw15m.length >= 5
        ? computeLightweight15m(raw15m, direction)
        : {
            bias: "NEUTRAL" as LightBias,
            biasStrength: 0,
            rangeContext: "MID_RANGE" as RangeContext15m,
            contextVerdict: "NEUTRAL" as ContextVerdict15m,
            contextSupport: 60,
          };

    if (result15m.contextVerdict === "HOSTILE") continue; // 15m gate reject

    // ── Top10QualityScore ───────────────────────────────────────────────────
    // 0.50 * breakoutScore_1m + 0.25 * pressure_1m + 0.15 * bs5m + 0.10 * support15m
    const top10QualityScore =
      0.5 * candidate.breakoutScore +
      0.25 * candidate.pressure.strength +
      0.15 * result5m.breakoutScoreProxy +
      0.1 * result15m.contextSupport;

    const tfAlignment: TfAlignment =
      result15m.contextSupport === 100 ? "3TF_ALIGNED" : "5M_CONFIRMED";

    gated.push({
      ...candidate,
      top10QualityScore,
      tfAlignment,
      contextSupport15m: result15m.contextSupport,
    });
  }

  // Sort by quality score descending
  gated.sort((a, b) => b.top10QualityScore - a.top10QualityScore);

  return gated;
}
