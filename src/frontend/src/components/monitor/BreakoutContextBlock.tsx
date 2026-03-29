import type { BreakoutContext } from "../../types";

interface BreakoutContextBlockProps {
  ctx: BreakoutContext | null;
}

function formatPrice(p: number): string {
  if (p >= 1000) return p.toFixed(1);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

export function BreakoutContextBlock({ ctx }: BreakoutContextBlockProps) {
  const biasColor =
    ctx?.bias === "UP"
      ? "text-radar-green"
      : ctx?.bias === "DOWN"
        ? "text-red-400"
        : "text-radar-dim";
  const biasIcon = ctx?.bias === "UP" ? "↑" : ctx?.bias === "DOWN" ? "↓" : "—";

  return (
    <div
      data-ocid="monitor.breakout_context.panel"
      className="card-glow bg-card rounded-2xl p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-radar-dim uppercase tracking-widest">
          BREAKOUT CONTEXT
        </span>
        {ctx && (
          <span className={`text-[11px] font-bold font-mono ${biasColor}`}>
            {biasIcon} {ctx.bias}
          </span>
        )}
      </div>

      {ctx ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-[9px] text-radar-dim font-mono uppercase tracking-wider">
              UPPER STRUCTURE
            </div>
            <div className="text-[14px] font-mono text-foreground/90">
              {formatPrice(ctx.upperStructure)}
            </div>
            <div className="text-[12px] font-bold font-mono text-radar-cyan">
              +{ctx.distanceToUpper.toFixed(2)}%
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[9px] text-radar-dim font-mono uppercase tracking-wider">
              LOWER STRUCTURE
            </div>
            <div className="text-[14px] font-mono text-foreground/90">
              {formatPrice(ctx.lowerStructure)}
            </div>
            <div className="text-[12px] font-bold font-mono text-red-400">
              -{ctx.distanceToLower.toFixed(2)}%
            </div>
          </div>

          {/* Nearest trigger side */}
          <div className="col-span-2 flex items-center justify-between pt-1 border-t border-white/5">
            <span className="text-[9px] text-radar-dim font-mono uppercase tracking-wider">
              NEAREST TRIGGER
            </span>
            <span
              className={`text-[11px] font-bold font-mono ${
                ctx.distanceToUpper <= ctx.distanceToLower
                  ? "text-radar-green"
                  : "text-red-400"
              }`}
            >
              {ctx.distanceToUpper <= ctx.distanceToLower ? "↑ UP" : "↓ DOWN"}
            </span>
          </div>

          {/* Visual proximity bar */}
          <div className="col-span-2">
            <div className="text-[9px] text-radar-dim font-mono uppercase tracking-wider mb-1.5">
              POSITION IN RANGE
            </div>
            <div className="relative h-2 rounded-full bg-secondary overflow-hidden">
              {/* Red zone - lower */}
              <div className="absolute left-0 inset-y-0 w-1/4 bg-red-500/30 rounded-l-full" />
              {/* Green zone - upper */}
              <div className="absolute right-0 inset-y-0 w-1/4 bg-radar-green/20 rounded-r-full" />
              {/* Position indicator */}
              {(() => {
                const range = ctx.upperStructure - ctx.lowerStructure;
                const posRaw =
                  range > 0
                    ? (ctx.upperStructure -
                        (ctx.distanceToUpper * ctx.upperStructure) / 100 -
                        ctx.lowerStructure) /
                      range
                    : 0.5;
                const pos = Math.max(0.02, Math.min(0.98, posRaw));
                return (
                  <div
                    className="absolute top-0 bottom-0 w-1.5 bg-radar-cyan rounded-full -translate-x-1/2"
                    style={{ left: `${pos * 100}%` }}
                  />
                );
              })()}
            </div>
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
