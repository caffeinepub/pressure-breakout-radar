# Pressure Breakout Radar

## Current State

Top 10 discovery is a pure 1m process:
- `updateLoops.ts` scans 150 symbols, fetches 1m klines, scores each with `computeTension / computePressure / computeBreakoutScore`
- `selectTop10` ranks by phase priority + breakoutScore and takes the best 10
- No multi-timeframe gating exists — pure 1m noise can dominate the list

## Requested Changes (Diff)

### Add
- `threeTFGate.ts` — new module containing:
  - `computeLightweight5m(klines)` → `{ bias, pressureDirection, pressureProxy, breakoutScoreProxy }`
  - `computeLightweight15m(klines, candidateDirection)` → `{ bias, biasStrength, rangeContext, contextVerdict, contextSupport }`
  - `runThreeTFGate(preCandidates)` — fetches 5m+15m klines for the symbols, gates, scores, returns `GatedCandidate[]`
- `tfAlignment?: "3TF_ALIGNED" | "5M_CONFIRMED"` field on `Candidate` type
- `top10QualityScore?: number` field on `Candidate` type
- Small badge in `Top10Card` showing `3TF ALIGNED` or `5M+1M` when tfAlignment is present
- `SCAN: 1M · 5M · 15M` context label in `Top10Card`

### Modify
- `updateLoops.ts` — after 1m scoring, apply pre-filter (pressure >= 70, breakoutScore >= 45, pressure.side != NEUTRAL), sort by phase+score, take top 20, run `runThreeTFGate`, sort result by `top10QualityScore`, take top 10. Fallback to existing `selectTop10` if gated set < 3.
- `top10Engine.ts` — export `PHASE_PRIORITY` constant for reuse in `updateLoops.ts`
- `types.ts` — add `tfAlignment` and `top10QualityScore` optional fields to `Candidate`
- `Top10Card.tsx` — render tfAlignment badge and scan label in bottom row

### Remove
- Nothing removed; existing pure-1m `selectTop10` stays as fallback

## Implementation Plan

1. Create `threeTFGate.ts` with lightweight computation functions and gate logic
2. Update `types.ts` with two new optional fields on `Candidate`
3. Update `top10Engine.ts` to export `PHASE_PRIORITY`
4. Update `updateLoops.ts` to integrate pre-filter → `runThreeTFGate` → final Top 10 each slow scan cycle
5. Update `Top10Card.tsx` to show alignment badge and scan label

### Gate flow (per slow scan cycle)
```
1. Score 1m candidates as now
2. Pre-filter: pressure.strength >= 70 && breakoutScore >= 45 && pressure.side != NEUTRAL
3. Sort by phase priority + breakoutScore → take top 20
4. For those 20: fetch 5m (last 20 candles) + 15m (last 20 candles) in parallel
5. Per candidate:
   a. Derive direction from pressure.side (UP→LONG, DOWN→SHORT)
   b. Compute lightweight5m → apply 5m gate (reject if 5m clearly contradicts 1m)
   c. Compute lightweight15m for candidate direction → apply 15m gate (reject if HOSTILE)
   d. Compute Top10QualityScore = 0.50*bs1m + 0.25*pressure1m + 0.15*bs5m + 0.10*support15m
   e. Assign tfAlignment: 3TF_ALIGNED (support=100) or 5M_CONFIRMED (support=60)
6. Sort gated by Top10QualityScore → take top 10 → assign ranks
7. Fallback to selectTop10(all candidates) if gated.length < 3
```

### Lightweight computation rules
- 5m bias: close position in 20-candle range + last-5-candle directional count
- 5m pressure proxy: directional body/range aggregation over last 10 candles
- 5m breakoutScore proxy: direction consistency + close location + continuation (last 3 candles)
- 15m bias: close position + bull/bear candle ratio over last 20 candles
- 15m rangeContext: UPPER (pos > 0.65) / LOWER (pos < 0.35) / MID
- 15m contextVerdict for LONG: HOSTILE if 15m SHORT bias strong; SUPPORTIVE if 15m LONG or NEUTRAL+not upper range
- 15m contextVerdict for SHORT: HOSTILE if 15m LONG bias strong; SUPPORTIVE if 15m SHORT or NEUTRAL+not lower range

### 5m contradiction rules
- LONG candidate: reject if bias_5m === SHORT, or bias NEUTRAL + pressureDir SHORT + proxy >= 60
- SHORT candidate: reject if bias_5m === LONG, or bias NEUTRAL + pressureDir LONG + proxy >= 60

### Top10QualityScore
```
0.50 * breakoutScore_1m + 0.25 * pressure_1m + 0.15 * breakoutScore_5m + 0.10 * contextSupport_15m
contextSupport_15m: 100 (SUPPORTIVE) | 60 (NEUTRAL) | 0 (HOSTILE — already rejected)
```
