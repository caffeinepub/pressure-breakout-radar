import type { Candidate, Phase } from "./types";

const PHASE_PRIORITY: Record<Phase, number> = {
  "PRE-BURST": 5,
  BUILDING: 4,
  ACTIVE: 3,
  BREAKOUT: 2,
  FLAT: 1,
};

export function selectTop10(
  candidates: Omit<Candidate, "rank">[],
): Candidate[] {
  const sorted = [...candidates].sort((a, b) => {
    const pDiff = PHASE_PRIORITY[b.phase] - PHASE_PRIORITY[a.phase];
    if (pDiff !== 0) return pDiff;
    return b.breakoutScore - a.breakoutScore;
  });

  return sorted.slice(0, 10).map((c, i) => ({ ...c, rank: i + 1 }));
}
