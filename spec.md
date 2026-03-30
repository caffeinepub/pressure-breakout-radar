# Pressure Breakout Radar

## Current State

Aggression bubbles are rendered in `CandlestickChart.tsx` with a `drawBubble` function and a clustering pass. Current state:
- Bubbles sorted weakest-first so strongest renders on top
- `clusterBubbles` in `monitorLoop.ts` keeps only the strongest bubble per 3-candle zone per side
- Minor cluster bubbles get 0.8 × 0.65 = 0.52 alpha vs 0.80 for dominant
- Radius comes from `getBubbleRadius` with 4 tiers: 10/14/18/22 based on strength thresholds 0/25/50/75
- No age-based fading — all bubbles render at the same base alpha regardless of age
- No micro-zone spatial proximity check between different candle zones — only within same 3-candle zone bucket
- Glow uses `shadowBlur = r * 0.7` which can still be heavy
- No protection from execution label overlap beyond z-order

## Requested Changes (Diff)

### Add
- Age-based opacity fade: compute age fraction from bubble's `candleOpenTime` vs the newest bubble's time. Divide into 4 age bands: fresh (0–25%), recent (25–50%), older (50–75%), near-expiring (75–100%). Apply fade multipliers: 1.0, 0.85, 0.65, 0.42.
- Micro-zone spatial proximity check in the render pass: if two same-side bubbles are within `r1 + r2 + 8px` of each other in screen-space, the weaker one gets an additional 0.55 multiplier on alpha so the stronger clearly dominates visually.
- Execution label proximity check: if bubble center is within `r + 20px` of any ENTRY/SL/TP label screen position, reduce that bubble's glow (shadowBlur cap to `r * 0.3`) and alpha by × 0.7 so labels remain readable.

### Modify
- `getBubbleRadius` tier sizes: cap extreme tier at 20 (was 22), strong at 16 (was 18), medium at 12 (was 14), weak at 8 (was 10). Slightly smaller overall so bubbles are less overpowering on mobile.
- Base alpha: raise dominant bubble base alpha to 0.85 (was 0.80) so the strongest is clearly the loudest. Keep minor alpha at 0.52 or lower.
- `drawBubble` glow: reduce `shadowBlur` from `r * 0.7` to `r * 0.5`. Reduce shadow alpha in color from 0.35 to 0.25. Keeps the suggestion without heavy glow noise.
- Cluster zone size in `clusterBubbles`: change zone bucket from `Math.floor(ci / 3)` to `Math.floor(ci / 2)` for 1m (tighter clustering), keep 3 for 5m/15m — controlled via timeframe parameter already passed.
- Render pass sort: keep weakest-first sort for z-ordering. The visual dominance for strength is handled by alpha + size.

### Remove
- Nothing removed; pure improvement/tuning pass.

## Implementation Plan

1. **`monitorLoop.ts`**: In `getBubbleRadius`, reduce all tier caps: extreme→20, strong→16, medium→12, weak→8.
2. **`CandlestickChart.tsx` — `drawBubble`**: Reduce `shadowBlur` to `r * 0.5`, shadow alpha from 0.35 → 0.25.
3. **`CandlestickChart.tsx` — bubble render loop**:
   a. Before the loop, compute `newestBubbleTime = max(candleOpenTime across all visible bubbles)` and `oldestBubbleTime = min(...)`. Compute age fraction per bubble.
   b. Age fade lookup: fresh→1.0, recent→0.85, older→0.65, near-expiring→0.42.
   c. Raise dominant base alpha to 0.85. Minor in cluster → 0.85 × 0.60.
   d. After computing `finalBy` and `bx` for each bubble, scan already-placed positions for same-side bubbles within `r + placed.r + 8`. If any found, apply additional × 0.55 to alpha (in addition to any minor-cluster flag).
   e. Collect label screen positions (ENTRY, SL, TP1, TP2) from the zones already drawn. Before calling `drawBubble`, check if `(bx, finalBy)` is within `r + 20` of any label. If so: cap glow to `r * 0.3` and reduce final alpha × 0.7.
4. Validate with typecheck + build.
