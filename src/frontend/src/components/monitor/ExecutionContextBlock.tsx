import type { ExecutionContext } from "../../types";

interface ExecutionContextBlockProps {
  ctx: ExecutionContext | null;
}

function formatPrice(p: number): string {
  if (p >= 1000) return p.toFixed(1);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function formatZone(z: { start: number; end: number }): string {
  return `${formatPrice(z.start)} — ${formatPrice(z.end)}`;
}

export function ExecutionContextBlock({ ctx }: ExecutionContextBlockProps) {
  const isInvalid = ctx?.executionInvalid === true;

  const qualityColor = isInvalid
    ? "text-red-400"
    : ctx?.executionQuality === "HIGH"
      ? "text-radar-green"
      : ctx?.executionQuality === "MEDIUM"
        ? "text-yellow-400"
        : "text-red-400";

  const qualityBg = isInvalid
    ? "bg-[oklch(0.65_0.20_25/12%)] border-[oklch(0.65_0.20_25/30%)]"
    : ctx?.executionQuality === "HIGH"
      ? "bg-[oklch(0.72_0.17_145/12%)] border-[oklch(0.72_0.17_145/30%)]"
      : ctx?.executionQuality === "MEDIUM"
        ? "bg-[oklch(0.75_0.15_75/12%)] border-[oklch(0.75_0.15_75/30%)]"
        : "bg-[oklch(0.65_0.20_25/12%)] border-[oklch(0.65_0.20_25/30%)]";

  const biasBg =
    ctx?.entryBias === "LONG"
      ? "bg-[oklch(0.72_0.17_145/12%)] border-[oklch(0.72_0.17_145/30%)] text-radar-green"
      : ctx?.entryBias === "SHORT"
        ? "bg-[oklch(0.65_0.20_25/12%)] border-[oklch(0.65_0.20_25/30%)] text-red-400"
        : "bg-[oklch(0.45_0.05_200/12%)] border-[oklch(0.45_0.05_200/25%)] text-radar-dim";

  const biasIcon =
    ctx?.entryBias === "LONG" ? "↑" : ctx?.entryBias === "SHORT" ? "↓" : "—";

  return (
    <div
      data-ocid="monitor.execution_context.panel"
      className="card-glow bg-card rounded-2xl p-4 space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-radar-dim uppercase tracking-widest">
          EXECUTION CONTEXT
        </span>
        {ctx && (
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[9px] font-bold font-mono px-2 py-0.5 rounded border ${
                isInvalid
                  ? "bg-[oklch(0.65_0.20_25/12%)] border-[oklch(0.65_0.20_25/30%)] text-red-400"
                  : biasBg
              }`}
            >
              {biasIcon} {ctx.entryBias}
            </span>
            <span
              className={`text-[9px] font-bold font-mono px-2 py-0.5 rounded border ${qualityBg} ${qualityColor}`}
            >
              {isInvalid ? "INVALID" : ctx.executionQuality}
            </span>
            {!isInvalid && ctx.rMultiple != null && ctx.rMultiple > 0 && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-[oklch(0.78_0.13_195/20%)] text-radar-dim">
                {ctx.rMultiple.toFixed(1)}R
              </span>
            )}
            {!isInvalid && ctx.structurallyLimited && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-[oklch(0.75_0.15_75/25%)] text-yellow-400/70">
                LTD
              </span>
            )}
          </div>
        )}
      </div>

      {ctx ? (
        <div className="space-y-2.5">
          {/* Range context row */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono text-radar-dim uppercase tracking-wider">
                RANGE CONTEXT
              </span>
              <span
                className={`text-[11px] font-bold font-mono ${
                  ctx.rangePosition === "UPPER"
                    ? "text-radar-green"
                    : ctx.rangePosition === "LOWER"
                      ? "text-red-400"
                      : "text-radar-dim"
                }`}
              >
                {ctx.rangePosition} RANGE
              </span>
            </div>
            <div className="relative h-1.5 rounded-full bg-secondary overflow-hidden">
              <div className="absolute left-0 inset-y-0 w-1/3 bg-red-500/25 rounded-l-full" />
              <div className="absolute right-0 inset-y-0 w-1/3 bg-[oklch(0.72_0.17_145/20%)] rounded-r-full" />
              <div
                className="absolute top-0 bottom-0 w-2 bg-radar-cyan rounded-full -translate-x-1/2"
                style={{
                  left: `${Math.max(2, Math.min(98, ctx.rangeValue * 100))}%`,
                }}
              />
            </div>
          </div>

          {/* Vacuum context row */}
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono text-radar-dim uppercase tracking-wider">
              VACUUM CONTEXT
            </span>
            <span
              className={`text-[11px] font-bold font-mono ${
                ctx.hasCleanEntry && !isInvalid
                  ? "text-radar-cyan"
                  : "text-radar-dim"
              }`}
            >
              {ctx.hasCleanEntry && ctx.entryBias === "LONG"
                ? "ABOVE"
                : ctx.hasCleanEntry && ctx.entryBias === "SHORT"
                  ? "BELOW"
                  : "CHECK CHART"}
            </span>
          </div>

          <div className="border-t border-white/5 pt-2 space-y-2">
            {/* INVALID execution state — shown instead of zones */}
            {isInvalid ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 py-1 px-2 rounded-lg bg-red-500/8 border border-red-500/20">
                  <span className="text-red-400 text-[13px] leading-none">
                    ⚠️
                  </span>
                  <span className="text-[11px] font-bold font-mono text-red-400">
                    {ctx.invalidReason ?? "INVALID EXECUTION"}
                  </span>
                </div>
                <p className="text-[9px] font-mono text-radar-dim/60 italic leading-snug">
                  Direction is aligned but reward structure is mathematically
                  inconsistent. No valid entry model can be drawn.
                </p>
              </div>
            ) : ctx.hasCleanEntry ? (
              <>
                {/* Entry Zone */}
                {ctx.entryZone && (
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[9px] font-mono text-radar-dim uppercase tracking-wider shrink-0">
                      ENTRY ZONE
                    </span>
                    <span
                      className={`text-[10px] font-mono text-right ${
                        ctx.entryBias === "LONG"
                          ? "text-radar-green"
                          : "text-red-400"
                      }`}
                    >
                      {formatZone(ctx.entryZone)}
                    </span>
                  </div>
                )}

                {/* SL Zone */}
                {ctx.slZone && (
                  <div className="flex items-start justify-between gap-2">
                    <div className="shrink-0 space-y-0.5">
                      <div className="text-[9px] font-mono text-radar-dim uppercase tracking-wider">
                        SL ZONE
                      </div>
                      <div className="text-[8px] font-mono text-red-400/60">
                        {ctx.entryBias === "LONG"
                          ? "LONG INVALIDATION"
                          : "SHORT INVALIDATION"}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-red-400 text-right">
                      {formatZone(ctx.slZone)}
                    </span>
                  </div>
                )}

                {/* TP1 Zone */}
                {ctx.tp1Zone && (
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[9px] font-mono text-radar-dim uppercase tracking-wider shrink-0">
                      TP1 ZONE
                    </span>
                    <span className="text-[10px] font-mono text-radar-cyan text-right">
                      {formatZone(ctx.tp1Zone)}
                    </span>
                  </div>
                )}

                {/* TP2 Zone */}
                {ctx.tp2Zone && (
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[9px] font-mono text-radar-dim uppercase tracking-wider shrink-0">
                      TP2 ZONE
                    </span>
                    <span className="text-[10px] font-mono text-radar-cyan/70 text-right">
                      {formatZone(ctx.tp2Zone)}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 py-0.5">
                <span className="text-[10px] font-mono text-radar-dim opacity-60">
                  NO CLEAN ENTRY ZONE
                </span>
              </div>
            )}
          </div>

          {/* Alignment score bar */}
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono text-radar-dim uppercase tracking-wider shrink-0">
              ALIGNMENT {ctx.alignmentScore}/6
            </span>
            <div className="flex gap-0.5 flex-1">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="flex-1 h-1 rounded-sm"
                  style={{
                    background:
                      i < ctx.alignmentScore
                        ? isInvalid
                          ? "oklch(0.65 0.20 25 / 60%)"
                          : ctx.executionQuality === "HIGH"
                            ? "oklch(0.72 0.17 145)"
                            : ctx.executionQuality === "MEDIUM"
                              ? "oklch(0.75 0.15 75)"
                              : "oklch(0.65 0.20 25)"
                        : "oklch(0.25 0.02 210)",
                  }}
                />
              ))}
            </div>
          </div>

          {/* Interpretation line */}
          <div className="pt-1 border-t border-white/5">
            <p
              className={`text-[10px] font-mono italic leading-snug ${
                isInvalid ? "text-red-400/70" : "text-radar-dim/80"
              }`}
            >
              {ctx.interpretationLine}
            </p>
          </div>
        </div>
      ) : (
        <div className="text-[13px] font-mono text-radar-dim animate-pulse">
          CALCULATING...
        </div>
      )}
    </div>
  );
}
