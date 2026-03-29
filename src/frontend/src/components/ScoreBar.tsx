interface ScoreBarProps {
  label: string;
  value: number;
  variant?: "orange" | "cyan" | "green";
  suffix?: string;
}

export function ScoreBar({
  label,
  value,
  variant = "cyan",
  suffix,
}: ScoreBarProps) {
  const fillClass =
    variant === "orange"
      ? "score-fill-orange"
      : variant === "green"
        ? "score-fill-green"
        : "score-fill-cyan";

  return (
    <div className="flex items-center gap-2 w-full">
      <span className="text-[10px] text-radar-dim uppercase tracking-wider w-[64px] shrink-0 font-mono">
        {label}
      </span>
      <div className="score-track flex-1">
        <div
          className={fillClass}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span className="text-[11px] font-mono text-foreground/70 w-[28px] text-right shrink-0">
        {Math.round(value)}
      </span>
      {suffix && (
        <span
          className="text-[10px] font-bold w-[28px] shrink-0"
          style={{ color: "oklch(0.78 0.13 195)" }}
        >
          {suffix}
        </span>
      )}
    </div>
  );
}
