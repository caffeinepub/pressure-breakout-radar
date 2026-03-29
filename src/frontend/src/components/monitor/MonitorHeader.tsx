import type { MonitorStatus, SelectedMonitorSnapshot } from "../../types";
import { PhaseBadge } from "../PhaseBadge";

interface MonitorHeaderProps {
  snapshot: SelectedMonitorSnapshot;
  onClose: () => void;
}

function formatPrice(price: number): string {
  if (price >= 1000)
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  if (price >= 1)
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  return price.toFixed(6);
}

function formatSymbol(s: string): string {
  return s.replace("USDT", "");
}

const statusConfig: Record<
  MonitorStatus,
  { label: string; color: string; pulse: boolean }
> = {
  LIVE: { label: "LIVE", color: "text-radar-green", pulse: true },
  STALE: { label: "STALE", color: "text-radar-orange", pulse: false },
  REFRESHING: { label: "REFRESHING", color: "text-radar-cyan", pulse: true },
  ERROR: { label: "ERROR", color: "text-red-400", pulse: false },
};

export function MonitorHeader({ snapshot, onClose }: MonitorHeaderProps) {
  const sc = statusConfig[snapshot.status];
  const biasColor =
    snapshot.breakoutContext?.bias === "UP"
      ? "text-radar-green"
      : snapshot.breakoutContext?.bias === "DOWN"
        ? "text-red-400"
        : "text-radar-dim";
  const biasArrow =
    snapshot.breakoutContext?.bias === "UP"
      ? "↑"
      : snapshot.breakoutContext?.bias === "DOWN"
        ? "↓"
        : "—";

  return (
    <div className="space-y-3">
      {/* Top row: back + status */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          data-ocid="monitor.close_button"
          onClick={onClose}
          className="flex items-center gap-1.5 text-radar-dim hover:text-foreground transition-colors text-[12px] font-mono"
        >
          <span className="text-base leading-none">←</span>
          <span>BACK</span>
        </button>
        <div className="flex items-center gap-1.5">
          {sc.pulse && (
            <span
              className={
                sc.color === "text-radar-cyan" ? "live-dot-cyan" : "live-dot"
              }
            />
          )}
          <span
            className={`text-[10px] font-bold font-mono tracking-widest ${sc.color}`}
          >
            {sc.label}
          </span>
        </div>
      </div>

      {/* Symbol + price row */}
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-[28px] font-bold tracking-tight text-foreground leading-none">
          {formatSymbol(snapshot.symbol)}
        </span>
        <span className="text-[20px] font-mono text-foreground/90 leading-none">
          {formatPrice(snapshot.price)}
        </span>
        <span className="text-[11px] text-radar-dim font-mono">
          USDT-M PERP
        </span>
      </div>

      {/* Phase + bias row */}
      <div className="flex items-center gap-2 flex-wrap">
        <PhaseBadge phase={snapshot.phase} />
        <span className={`text-[11px] font-bold font-mono ${biasColor}`}>
          {biasArrow} {snapshot.breakoutContext?.bias ?? "NEUTRAL"}
        </span>
      </div>

      {/* Score row */}
      <div className="flex items-center gap-3 pt-1">
        <div className="flex flex-col items-center">
          <span className="text-[9px] text-radar-dim uppercase tracking-widest font-mono">
            TENSION
          </span>
          <span className="text-[18px] font-bold font-mono text-radar-orange leading-tight">
            {Math.round(snapshot.tension)}
          </span>
        </div>
        <div className="w-px h-8 bg-border" />
        <div className="flex flex-col items-center">
          <span className="text-[9px] text-radar-dim uppercase tracking-widest font-mono">
            PRESSURE
          </span>
          <span className="text-[18px] font-bold font-mono text-radar-cyan leading-tight">
            {Math.round(snapshot.pressure.strength)}
          </span>
        </div>
        <div className="w-px h-8 bg-border" />
        <div className="flex flex-col items-center">
          <span className="text-[9px] text-radar-dim uppercase tracking-widest font-mono">
            BREAKOUT
          </span>
          <span className="text-[18px] font-bold font-mono text-radar-green leading-tight">
            {Math.round(snapshot.breakoutScore)}
          </span>
        </div>
      </div>
    </div>
  );
}
