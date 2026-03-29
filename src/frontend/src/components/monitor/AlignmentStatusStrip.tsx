interface AlignmentStatusStripProps {
  breakoutBias: "UP" | "DOWN" | "NEUTRAL" | null | undefined;
  pressureSide: "UP" | "DOWN" | "NEUTRAL" | null | undefined;
}

type AlignmentStatus =
  | "FULL LONG ALIGNMENT"
  | "FULL SHORT ALIGNMENT"
  | "MICRO PULLBACK INSIDE LONG BREAKOUT"
  | "MICRO BOUNCE INSIDE SHORT BREAKOUT"
  | "MOMENTUM CONFLICT"
  | "NO CLEAR ALIGNMENT";

function deriveStatus(
  breakoutBias: AlignmentStatusStripProps["breakoutBias"],
  pressureSide: AlignmentStatusStripProps["pressureSide"],
): AlignmentStatus {
  if (!breakoutBias || !pressureSide) return "NO CLEAR ALIGNMENT";
  if (breakoutBias === "NEUTRAL" || pressureSide === "NEUTRAL")
    return "NO CLEAR ALIGNMENT";
  if (breakoutBias === "UP" && pressureSide === "UP")
    return "FULL LONG ALIGNMENT";
  if (breakoutBias === "DOWN" && pressureSide === "DOWN")
    return "FULL SHORT ALIGNMENT";
  if (breakoutBias === "UP" && pressureSide === "DOWN")
    return "MICRO PULLBACK INSIDE LONG BREAKOUT";
  if (breakoutBias === "DOWN" && pressureSide === "UP")
    return "MICRO BOUNCE INSIDE SHORT BREAKOUT";
  return "MOMENTUM CONFLICT";
}

const STATUS_CONFIG: Record<
  AlignmentStatus,
  { dotColor: string; textColor: string; borderColor: string; bgColor: string }
> = {
  "FULL LONG ALIGNMENT": {
    dotColor: "bg-radar-green",
    textColor: "text-radar-green",
    borderColor: "border-green-500/20",
    bgColor: "bg-green-500/5",
  },
  "FULL SHORT ALIGNMENT": {
    dotColor: "bg-red-400",
    textColor: "text-red-400",
    borderColor: "border-red-500/20",
    bgColor: "bg-red-500/5",
  },
  "MICRO PULLBACK INSIDE LONG BREAKOUT": {
    dotColor: "bg-radar-cyan",
    textColor: "text-radar-cyan",
    borderColor: "border-cyan-400/15",
    bgColor: "bg-cyan-400/5",
  },
  "MICRO BOUNCE INSIDE SHORT BREAKOUT": {
    dotColor: "bg-orange-400",
    textColor: "text-orange-400",
    borderColor: "border-orange-400/15",
    bgColor: "bg-orange-400/5",
  },
  "MOMENTUM CONFLICT": {
    dotColor: "bg-yellow-400",
    textColor: "text-yellow-400",
    borderColor: "border-yellow-400/15",
    bgColor: "bg-yellow-400/5",
  },
  "NO CLEAR ALIGNMENT": {
    dotColor: "bg-radar-dim",
    textColor: "text-radar-dim",
    borderColor: "border-white/10",
    bgColor: "bg-transparent",
  },
};

function getHint(
  breakoutBias: AlignmentStatusStripProps["breakoutBias"],
  pressureSide: AlignmentStatusStripProps["pressureSide"],
): string {
  const b = breakoutBias === "UP" ? "↑" : breakoutBias === "DOWN" ? "↓" : "–";
  const p = pressureSide === "UP" ? "↑" : pressureSide === "DOWN" ? "↓" : "–";
  return `BIAS ${b} · PRESS ${p}`;
}

export function AlignmentStatusStrip({
  breakoutBias,
  pressureSide,
}: AlignmentStatusStripProps) {
  const status = deriveStatus(breakoutBias, pressureSide);
  const cfg = STATUS_CONFIG[status];

  return (
    <div
      data-ocid="monitor.alignment.panel"
      className={`flex items-center gap-2 w-full px-3 py-1 rounded-lg border ${
        cfg.borderColor
      } ${cfg.bgColor}`}
    >
      {/* Dot */}
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dotColor}`} />

      {/* Label */}
      <span
        className={`flex-1 text-[10px] font-mono font-bold tracking-widest uppercase ${cfg.textColor}`}
      >
        {status}
      </span>

      {/* Hint */}
      <span className="text-[9px] font-mono text-radar-dim shrink-0">
        {getHint(breakoutBias, pressureSide)}
      </span>
    </div>
  );
}
