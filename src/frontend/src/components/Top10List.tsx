import { AnimatePresence, motion } from "motion/react";
import { useTop10SelectionStore } from "../stores/top10SelectionStore";
import { useUIStore } from "../stores/uiStore";
import { Top10Card } from "./Top10Card";

export function Top10List() {
  const candidates = useTop10SelectionStore((s) => s.candidates);
  const isInitialized = useTop10SelectionStore((s) => s.isInitialized);
  const appStatus = useUIStore((s) => s.appStatus);
  const isCachedData = useUIStore((s) => s.isCachedData);

  if (!isInitialized && appStatus === "SCANNING") {
    return (
      <div
        data-ocid="top10.loading_state"
        className="flex flex-col items-center justify-center py-20 gap-4"
      >
        <div className="flex items-center gap-2">
          <span className="live-dot-cyan" />
          <span className="text-radar-cyan text-sm font-mono tracking-widest uppercase scan-blink">
            Calculating...
          </span>
        </div>
        <p className="text-radar-dim text-xs text-center max-w-[240px]">
          Scanning Binance futures universe for breakout candidates
        </p>
      </div>
    );
  }

  if (appStatus === "ERROR" && candidates.length === 0) {
    return (
      <div
        data-ocid="top10.error_state"
        className="flex flex-col items-center justify-center py-20 gap-3"
      >
        <span className="text-red-400 text-sm font-mono tracking-widest uppercase">
          Data Unavailable
        </span>
        <p className="text-radar-dim text-xs text-center">
          Could not retrieve breakout candidates.
          <br />
          Check your connection and try again.
        </p>
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div
        data-ocid="top10.empty_state"
        className="flex flex-col items-center justify-center py-20 gap-3"
      >
        <span className="text-radar-dim text-sm font-mono tracking-widest uppercase">
          No Breakout Candidates
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Cached data notice */}
      {isCachedData && appStatus === "SCANNING" && (
        <div className="flex items-center justify-center gap-2 py-1.5">
          <span className="live-dot-cyan" />
          <span className="text-[10px] text-radar-dim font-mono uppercase tracking-wider">
            Using last cached top 10 — rescanning...
          </span>
        </div>
      )}

      {/* Section label */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-radar-cyan uppercase tracking-widest font-semibold">
          Top 10 Breakout Candidates
        </span>
        <span className="text-[10px] text-radar-dim font-mono">
          {candidates.length} found
        </span>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key="top10-list"
          className="space-y-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          {candidates.map((candidate, i) => (
            <motion.div
              key={candidate.symbol}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.3 }}
            >
              <Top10Card candidate={candidate} index={i} />
            </motion.div>
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
