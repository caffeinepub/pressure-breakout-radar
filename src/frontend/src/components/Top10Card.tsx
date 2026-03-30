import { useTop10LiveStore } from "../stores/top10LiveStore";
import { useUIStore } from "../stores/uiStore";
import type { Candidate } from "../types";
import { PhaseBadge } from "./PhaseBadge";
import { ScoreBar } from "./ScoreBar";

interface Top10CardProps {
  candidate: Candidate;
  index: number;
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

function formatSymbol(symbol: string): string {
  return symbol.replace("USDT", "");
}

export function Top10Card({ candidate, index }: Top10CardProps) {
  const patch = useTop10LiveStore((s) => s.patches[candidate.symbol]);
  const setSelectedSymbol = useUIStore((s) => s.setSelectedSymbol);

  // Merge base data with live patch
  const price = patch?.price ?? candidate.price;
  const pct = patch?.priceChangePercent ?? candidate.priceChangePercent;
  const tension = patch?.tension ?? candidate.tension;
  const pressure = patch?.pressure ?? candidate.pressure;
  const breakoutScore = patch?.breakoutScore ?? candidate.breakoutScore;
  const phase = patch?.phase ?? candidate.phase;
  const vacuumSide = patch?.vacuumSide ?? candidate.vacuumSide;

  const isLive =
    patch?.lastUpdateTime && Date.now() - patch.lastUpdateTime < 15_000;
  const pctSign = pct >= 0 ? "+" : "";
  const pctColor = pct >= 0 ? "text-radar-green" : "text-red-400";
  const pressureArrow =
    pressure.side === "UP" ? "↑" : pressure.side === "DOWN" ? "↓" : "—";
  const pressureColor =
    pressure.side === "UP"
      ? "text-radar-green"
      : pressure.side === "DOWN"
        ? "text-red-400"
        : "text-radar-dim";

  const vacuumColor =
    vacuumSide === "ABOVE"
      ? "text-radar-cyan"
      : vacuumSide === "BELOW"
        ? "text-red-400"
        : "text-radar-dim";

  const rankStr = String(candidate.rank).padStart(2, "0");

  // 3TF alignment badge
  const tfAlignment = candidate.tfAlignment;
  const tfBadgeLabel =
    tfAlignment === "3TF_ALIGNED"
      ? "3TF"
      : tfAlignment === "5M_CONFIRMED"
        ? "5M+"
        : null;
  const tfBadgeColor =
    tfAlignment === "3TF_ALIGNED"
      ? "text-radar-cyan border-radar-cyan/40 bg-radar-cyan/10"
      : "text-radar-dim border-radar-dim/30 bg-transparent";

  return (
    <button
      type="button"
      data-ocid={`top10.item.${index + 1}`}
      onClick={() => setSelectedSymbol(candidate.symbol)}
      className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-radar-cyan rounded-2xl"
    >
      <div className="card-glow bg-card rounded-2xl p-4 space-y-2.5 active:opacity-80 transition-opacity">
        {/* Row 1: Rank | Symbol + Price | Phase | Live dot */}
        <div className="flex items-center gap-2.5">
          {/* Rank badge */}
          <div className="rank-ring w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold font-mono text-radar-orange">
              {rankStr}
            </span>
          </div>

          {/* Symbol + price */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[15px] font-bold text-foreground tracking-tight">
                {formatSymbol(candidate.symbol)}
              </span>
              <span className="text-[11px] font-mono text-foreground/80">
                {formatPrice(price)}
              </span>
              <span className={`text-[10px] font-mono ${pctColor}`}>
                ({pctSign}
                {pct.toFixed(2)}%)
              </span>
            </div>
          </div>

          {/* Phase badge */}
          <PhaseBadge phase={phase} />

          {/* Live dot */}
          {isLive && <span className="live-dot" />}
        </div>

        {/* Row 2-4: Score bars */}
        <div className="space-y-1.5 pl-10">
          <ScoreBar label="Tension" value={tension} variant="orange" />
          <ScoreBar
            label="Pressure"
            value={pressure.strength}
            variant="cyan"
            suffix={`${pressureArrow}`}
          />
          <div className="flex items-center gap-2 w-full">
            <span className="text-[10px] text-radar-dim uppercase tracking-wider w-[64px] shrink-0 font-mono">
              B.Score
            </span>
            <div className="score-track flex-1">
              <div
                className="score-fill-green"
                style={{
                  width: `${Math.min(100, Math.max(0, breakoutScore))}%`,
                }}
              />
            </div>
            <span className="text-[11px] font-mono text-foreground/70 w-[28px] text-right shrink-0">
              {Math.round(breakoutScore)}
            </span>
          </div>
        </div>

        {/* Row 5: Vacuum + Pressure side + 3TF badge */}
        <div className="flex items-center justify-between pl-10">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-radar-dim">
              Vacuum:{" "}
              <span className={`font-bold ${vacuumColor}`}>{vacuumSide}</span>
            </span>
            {/* Scan context label */}
            <span className="text-[9px] text-radar-dim/50 font-mono">
              1M·5M·15M
            </span>
            {/* 3TF alignment badge */}
            {tfBadgeLabel && (
              <span
                className={`text-[9px] font-bold font-mono px-1 py-0.5 rounded border ${tfBadgeColor}`}
              >
                {tfBadgeLabel}
              </span>
            )}
          </div>
          <span className={`text-[10px] font-bold ${pressureColor}`}>
            {pressure.side !== "NEUTRAL" && (
              <>
                {pressureArrow} {pressure.side}
              </>
            )}
          </span>
        </div>
      </div>
    </button>
  );
}
