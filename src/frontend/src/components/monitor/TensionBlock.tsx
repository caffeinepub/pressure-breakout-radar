import type { TrendDirection } from "../../types";

interface TensionBlockProps {
  tension: number | null;
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

export function TensionBlock({ tension, trend }: TensionBlockProps) {
  const isReady = tension !== null && trend !== null;
  const tc = trend ? trendConfig[trend] : null;

  return (
    <div
      data-ocid="monitor.tension.panel"
      className="card-glow bg-card rounded-xl p-2.5 space-y-1.5"
    >
      <span className="text-[9px] font-mono text-radar-dim uppercase tracking-widest">
        TENSION
      </span>

      {isReady ? (
        <>
          <div className="text-[26px] font-bold font-mono text-radar-orange leading-none">
            {Math.round(tension!)}
          </div>
          <div className="score-track w-full" style={{ height: "3px" }}>
            <div
              className="score-fill-orange"
              style={{
                width: `${Math.min(100, Math.max(0, tension!))}%`,
                height: "3px",
              }}
            />
          </div>
          <div className="text-[9px] text-radar-dim font-mono leading-none">
            {(tension ?? 0) > 70
              ? "HIGH COMPRESSION"
              : (tension ?? 0) > 40
                ? "MODERATE"
                : "LOW"}
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
