import type { Phase } from "../types";

interface PhaseBadgeProps {
  phase: Phase;
}

const phaseClass: Record<Phase, string> = {
  "PRE-BURST": "phase-preburst",
  BUILDING: "phase-building",
  ACTIVE: "phase-active",
  BREAKOUT: "phase-breakout",
  FLAT: "phase-flat",
};

const phaseLabel: Record<Phase, string> = {
  "PRE-BURST": "PRE-BURST",
  BUILDING: "BUILDING",
  ACTIVE: "ACTIVE",
  BREAKOUT: "BREAKOUT",
  FLAT: "FLAT",
};

export function PhaseBadge({ phase }: PhaseBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase ${phaseClass[phase]}`}
    >
      {phaseLabel[phase]}
    </span>
  );
}
