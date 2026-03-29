import type { PressureResult, TrendDirection } from "../../types";

interface PressureBlockProps {
  pressure: PressureResult | null;
  trend: TrendDirection | null;
}

const trendConfig: Record<
  TrendDirection,
  { label: string; icon: string; color: string }
> = {
  RISING: { label: "RISING", icon: "↑", color: "text-radar-green" },
  FALLING: { label: "FALLING", icon: "↓", color: "text-red-400" },
  FLAT: { label: "FLAT", icon: "—", color: "text-radar-dim" },
};

export function PressureBlock({ pressure, trend }: PressureBlockProps) {
  const isReady = pressure !== null && trend !== null;
  const tc = trend ? trendConfig[trend] : null;

  const sideColor =
    pressure?.side === "UP"
      ? "text-radar-green"
      : pressure?.side === "DOWN"
        ? "text-red-400"
        : "text-radar-dim";
  const sideIcon =
    pressure?.side === "UP" ? "↑" : pressure?.side === "DOWN" ? "↓" : "—";

  return (
    <div
      data-ocid="monitor.pressure.panel"
      className="card-glow bg-card rounded-xl p-2.5 space-y-1.5"
    >
      <span className="text-[9px] font-mono text-radar-dim uppercase tracking-widest">
        PRESSURE
      </span>

      {isReady ? (
        <>
          <div
            className={`text-[24px] font-bold font-mono leading-none flex items-center gap-1.5 ${sideColor}`}
          >
            <span>{sideIcon}</span>
            <span>{pressure!.side}</span>
          </div>
          <div className="score-track w-full" style={{ height: "3px" }}>
            <div
              className="score-fill-cyan"
              style={{
                width: `${Math.min(100, Math.max(0, pressure!.strength))}%`,
                height: "3px",
              }}
            />
          </div>
          <div className="text-[9px] text-radar-dim font-mono leading-none">
            STR {Math.round(pressure!.strength)}
          </div>
          <div className="flex items-center justify-between pt-0.5 border-t border-white/5">
            <span className="text-[8px] font-mono text-radar-dim uppercase tracking-wider">
              TREND
            </span>
            {tc && (
              <span
                className={`text-[9px] font-bold font-mono tracking-widest ${tc.color}`}
              >
                {tc.icon} {tc.label}
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="text-[11px] font-mono text-radar-dim animate-pulse">
          CALCULATING...
        </div>
      )}
    </div>
  );
}
