import type { ExecutionContext } from "../../types";

interface ExecutionContextBlockProps {
  ctx: ExecutionContext | null;
}

function formatPrice(p: number): string {
  if (p >= 1000) return p.toFixed(1);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function formatZone(z: { start: number; end: number }): string {
  return `${formatPrice(z.start)} — ${formatPrice(z.end)}`;
}

function DirectionalBadge({ state }: { state: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    FULL_LONG: {
      label: "FULL LONG",
      cls: "text-radar-green bg-[oklch(0.72_0.17_145/15%)] border-[oklch(0.72_0.17_145/35%)]",
    },
    FULL_SHORT: {
      label: "FULL SHORT",
      cls: "text-red-400 bg-[oklch(0.65_0.20_25/15%)] border-[oklch(0.65_0.20_25/35%)]",
    },
    LONG_LEAN: {
      label: "LONG LEAN",
      cls: "text-[oklch(0.72_0.12_145)] bg-[oklch(0.72_0.17_145/8%)] border-[oklch(0.72_0.17_145/20%)]",
    },
    SHORT_LEAN: {
      label: "SHORT LEAN",
      cls: "text-[oklch(0.65_0.15_25)] bg-[oklch(0.65_0.20_25/8%)] border-[oklch(0.65_0.20_25/20%)]",
    },
    CONFLICT: {
      label: "CONFLICT",
      cls: "text-yellow-400 bg-[oklch(0.75_0.15_75/10%)] border-[oklch(0.75_0.15_75/25%)]",
    },
    NO_CLEAR: {
      label: "NO CLEAR",
      cls: "text-radar-dim bg-[oklch(0.25_0.02_210/40%)] border-[oklch(0.35_0.02_210/30%)]",
    },
  };
  const entry = map[state] ?? map.NO_CLEAR;
  return (
    <span
      className={`text-[9px] font-bold font-mono px-2 py-0.5 rounded border ${entry.cls}`}
    >
      {entry.label}
    </span>
  );
}

function ValidityBadge({
  state,
  isInvalid,
}: { state: string; isInvalid: boolean }) {
  if (
    isInvalid &&
    state !== "LONG_BIAS_NO_EXEC" &&
    state !== "SHORT_BIAS_NO_EXEC" &&
    state !== "SHORT_BIAS_NO_CLEAN_ENTRY" &&
    state !== "LONG_BIAS_NO_CLEAN_ENTRY"
  ) {
    return (
      <span className="text-[9px] font-bold font-mono px-2 py-0.5 rounded border text-red-400 bg-[oklch(0.65_0.20_25/12%)] border-[oklch(0.65_0.20_25/30%)]">
        INVALID
      </span>
    );
  }
  const map: Record<string, { label: string; cls: string }> = {
    VALID_LONG: {
      label: "VALID LONG",
      cls: "text-radar-green bg-[oklch(0.72_0.17_145/15%)] border-[oklch(0.72_0.17_145/40%)]",
    },
    VALID_SHORT: {
      label: "VALID SHORT",
      cls: "text-red-400 bg-[oklch(0.65_0.20_25/15%)] border-[oklch(0.65_0.20_25/40%)]",
    },
    LONG_BIAS_NO_EXEC: {
      label: "LONG BIAS / NO EXEC",
      cls: "text-amber-400 bg-[oklch(0.72_0.15_60/10%)] border-[oklch(0.72_0.15_60/30%)]",
    },
    SHORT_BIAS_NO_EXEC: {
      label: "SHORT BIAS / NO EXEC",
      cls: "text-amber-400 bg-[oklch(0.72_0.15_60/10%)] border-[oklch(0.72_0.15_60/30%)]",
    },
    LONG_BIAS_NO_CLEAN_ENTRY: {
      label: "LONG BIAS / NO CLEAN ENTRY",
      cls: "text-amber-400 bg-[oklch(0.72_0.15_60/10%)] border-[oklch(0.72_0.15_60/30%)]",
    },
    SHORT_BIAS_NO_CLEAN_ENTRY: {
      label: "SHORT BIAS / NO CLEAN ENTRY",
      cls: "text-amber-400 bg-[oklch(0.72_0.15_60/10%)] border-[oklch(0.72_0.15_60/30%)]",
    },
    LONG_NO_AGGRESSION_CLUSTER: {
      label: "NO AGG CLUSTER",
      cls: "text-radar-dim bg-[oklch(0.25_0.02_210/40%)] border-[oklch(0.35_0.02_210/30%)]",
    },
    SHORT_NO_AGGRESSION_CLUSTER: {
      label: "NO AGG CLUSTER",
      cls: "text-radar-dim bg-[oklch(0.25_0.02_210/40%)] border-[oklch(0.35_0.02_210/30%)]",
    },
    NEUTRAL_LOW: {
      label: "NEUTRAL / LOW",
      cls: "text-radar-dim bg-[oklch(0.25_0.02_210/40%)] border-[oklch(0.35_0.02_210/30%)]",
    },
  };
  const entry = map[state] ?? map.NEUTRAL_LOW;
  return (
    <span
      className={`text-[9px] font-bold font-mono px-2 py-0.5 rounded border ${entry.cls}`}
    >
      {entry.label}
    </span>
  );
}

export function ExecutionContextBlock({ ctx }: ExecutionContextBlockProps) {
  const isInvalid = ctx?.executionInvalid === true;
  const execValidity = ctx?.executionValidityState ?? "NEUTRAL_LOW";
  const isOverheadVacuumShort = ctx?.isOverheadVacuumShort === true;
  const _noAggressionCluster = ctx?.noAggressionCluster === true;
  const isBiasNoExec =
    execValidity === "LONG_BIAS_NO_EXEC" ||
    execValidity === "SHORT_BIAS_NO_EXEC";
  const isNoCleanEntry =
    execValidity === "SHORT_BIAS_NO_CLEAN_ENTRY" ||
    execValidity === "LONG_BIAS_NO_CLEAN_ENTRY";
  const isNoAggrCluster =
    execValidity === "LONG_NO_AGGRESSION_CLUSTER" ||
    execValidity === "SHORT_NO_AGGRESSION_CLUSTER";
  const isValidExec =
    execValidity === "VALID_LONG" || execValidity === "VALID_SHORT";

  const alignmentBarColor =
    isInvalid && !isBiasNoExec && !isNoCleanEntry
      ? "oklch(0.65 0.20 25 / 60%)"
      : isBiasNoExec || isNoCleanEntry
        ? "oklch(0.72 0.15 60 / 70%)"
        : ctx?.executionQuality === "HIGH"
          ? "oklch(0.72 0.17 145)"
          : ctx?.executionQuality === "MEDIUM"
            ? "oklch(0.75 0.15 75)"
            : "oklch(0.65 0.20 25)";

  return (
    <div
      data-ocid="monitor.execution_context.panel"
      className="card-glow bg-card rounded-2xl p-4 space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-radar-dim uppercase tracking-widest">
          EXECUTION CONTEXT
        </span>
        {ctx && (
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <DirectionalBadge state={ctx.directionalState ?? "NO_CLEAR"} />
            <ValidityBadge state={execValidity} isInvalid={isInvalid} />
            {isValidExec && ctx.rMultiple != null && ctx.rMultiple > 0 && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-[oklch(0.78_0.13_195/20%)] text-radar-dim">
                {ctx.rMultiple.toFixed(1)}R
              </span>
            )}
            {isValidExec && ctx.structurallyLimited && (
              <span className="text-[8px] font-mono px-1.5 py-0.5 rounded border border-[oklch(0.75_0.15_75/25%)] text-yellow-400/70">
                LTD
              </span>
            )}
          </div>
        )}
      </div>

      {ctx ? (
        <div className="space-y-2.5">
          {/* Range context row */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono text-radar-dim uppercase tracking-wider">
                RANGE CONTEXT
              </span>
              <span
                className={`text-[11px] font-bold font-mono ${
                  ctx.rangePosition === "UPPER"
                    ? "text-radar-green"
                    : ctx.rangePosition === "LOWER"
                      ? "text-red-400"
                      : "text-radar-dim"
                }`}
              >
                {ctx.rangePosition} RANGE
              </span>
            </div>
            <div className="relative h-1.5 rounded-full bg-secondary overflow-hidden">
              <div className="absolute left-0 inset-y-0 w-1/3 bg-red-500/25 rounded-l-full" />
              <div className="absolute right-0 inset-y-0 w-1/3 bg-[oklch(0.72_0.17_145/20%)] rounded-r-full" />
              <div
                className="absolute top-0 bottom-0 w-2 bg-radar-cyan rounded-full -translate-x-1/2"
                style={{
                  left: `${Math.max(2, Math.min(98, ctx.rangeValue * 100))}%`,
                }}
              />
            </div>
          </div>

          {/* Vacuum context row */}
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono text-radar-dim uppercase tracking-wider">
              VACUUM CONTEXT
            </span>
            <span
              className={`text-[11px] font-bold font-mono ${
                isNoCleanEntry
                  ? "text-amber-400/80"
                  : isValidExec
                    ? "text-radar-cyan"
                    : "text-radar-dim"
              }`}
            >
              {isOverheadVacuumShort
                ? "OVERHEAD (RESISTANCE)"
                : ctx.entryBias === "LONG"
                  ? "ABOVE"
                  : ctx.entryBias === "SHORT"
                    ? "BELOW"
                    : "CHECK CHART"}
            </span>
          </div>

          <div className="border-t border-white/5 pt-2 space-y-2">
            {/* NO AGGRESSION CLUSTER */}
            {isNoAggrCluster && (
              <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-white/3 border border-white/8">
                <span className="text-radar-dim text-[13px] leading-none">
                  ◎
                </span>
                <div className="space-y-0.5">
                  <div className="text-[10px] font-bold font-mono text-radar-dim">
                    NO CLEAN ENTRY ZONE
                  </div>
                  <div className="text-[8px] font-mono text-radar-dim/50">
                    NO AGGRESSION CLUSTER DETECTED
                  </div>
                </div>
              </div>
            )}

            {/* NO CLEAN ENTRY — price too far from aggression cluster */}
            {isNoCleanEntry && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-amber-500/8 border border-amber-500/20">
                  <span className="text-amber-400 text-[14px] leading-none">
                    ⏳
                  </span>
                  <div className="space-y-0.5">
                    <div className="text-[10px] font-bold font-mono text-amber-400">
                      {execValidity === "LONG_BIAS_NO_CLEAN_ENTRY"
                        ? "LONG BIAS / NO CLEAN ENTRY"
                        : "SHORT BIAS / NO CLEAN ENTRY"}
                    </div>
                    <div className="text-[8px] font-mono text-amber-400/60">
                      {execValidity === "LONG_BIAS_NO_CLEAN_ENTRY"
                        ? "WAIT FOR RE-ENTRY NEAR AGGRESSION"
                        : "WAIT FOR RETEST"}
                    </div>
                  </div>
                </div>

                {/* Ideal long entry zone reference (faint) */}
                {execValidity === "LONG_BIAS_NO_CLEAN_ENTRY" &&
                  ctx.idealLongEntryZone && (
                    <div className="flex items-start justify-between gap-2 opacity-60">
                      <div className="shrink-0 space-y-0.5">
                        <div className="text-[9px] font-mono text-radar-green/70 uppercase tracking-wider">
                          IDEAL LONG ENTRY
                        </div>
                        <div className="text-[8px] font-mono text-radar-dim/50">
                          AGGRESSION CLUSTER ZONE
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-radar-green/70 text-right">
                        {formatZone(ctx.idealLongEntryZone)}
                      </span>
                    </div>
                  )}

                {/* Ideal short entry zone reference (faint) */}
                {execValidity === "SHORT_BIAS_NO_CLEAN_ENTRY" &&
                  ctx.idealShortEntryZone && (
                    <div className="flex items-start justify-between gap-2 opacity-60">
                      <div className="shrink-0 space-y-0.5">
                        <div className="text-[9px] font-mono text-amber-400/70 uppercase tracking-wider">
                          IDEAL SHORT ENTRY
                        </div>
                        <div className="text-[8px] font-mono text-radar-dim/50">
                          AGGRESSION CLUSTER ZONE
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-amber-400/70 text-right">
                        {formatZone(ctx.idealShortEntryZone)}
                      </span>
                    </div>
                  )}

                {/* SL / invalidation reference (faint) */}
                {ctx.vacuumInvalidationZone && (
                  <div className="flex items-start justify-between gap-2 opacity-60">
                    <div className="shrink-0 space-y-0.5">
                      <div className="text-[9px] font-mono text-radar-dim/70 uppercase tracking-wider">
                        INVALIDATION
                      </div>
                      <div className="text-[8px] font-mono text-red-400/50">
                        {execValidity === "LONG_BIAS_NO_CLEAN_ENTRY"
                          ? "BELOW CLUSTER SUPPORT"
                          : "VACUUM TOP + BUFFER"}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-red-400/60 text-right">
                      {formatZone(ctx.vacuumInvalidationZone)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* BIAS but no valid execution (reward math failed) */}
            {isBiasNoExec && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 py-1 px-2 rounded-lg bg-amber-500/8 border border-amber-500/20">
                  <span className="text-amber-400 text-[13px] leading-none">
                    ⚡
                  </span>
                  <span className="text-[11px] font-bold font-mono text-amber-400">
                    {execValidity === "LONG_BIAS_NO_EXEC"
                      ? "LONG BIAS / NO VALID EXECUTION"
                      : "SHORT BIAS / NO VALID EXECUTION"}
                  </span>
                </div>
                <p className="text-[9px] font-mono text-radar-dim/60 italic leading-snug">
                  {ctx.interpretationLine}
                </p>
              </div>
            )}

            {/* INVALID execution (math contradictory) */}
            {isInvalid &&
              !isBiasNoExec &&
              !isNoCleanEntry &&
              !isNoAggrCluster && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 py-1 px-2 rounded-lg bg-red-500/8 border border-red-500/20">
                    <span className="text-red-400 text-[13px] leading-none">
                      ⚠️
                    </span>
                    <span className="text-[11px] font-bold font-mono text-red-400">
                      {ctx.invalidReason ?? "INVALID EXECUTION"}
                    </span>
                  </div>
                  <p className="text-[9px] font-mono text-radar-dim/60 italic leading-snug">
                    Direction is aligned but reward structure is mathematically
                    inconsistent. No valid entry model can be drawn.
                  </p>
                </div>
              )}

            {/* VALID execution — show aggression-anchored zones */}
            {isValidExec && ctx.entryZone && (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="shrink-0 space-y-0.5">
                    <div className="text-[9px] font-mono text-radar-dim uppercase tracking-wider">
                      ENTRY ZONE
                    </div>
                    <div className="text-[8px] font-mono text-radar-dim/50">
                      {ctx.entryBias === "LONG"
                        ? "BULLISH AGGRESSION CLUSTER"
                        : "BEARISH AGGRESSION CLUSTER"}
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-mono text-right ${
                      ctx.entryBias === "LONG"
                        ? "text-radar-green"
                        : "text-red-400"
                    }`}
                  >
                    {formatZone(ctx.entryZone)}
                  </span>
                </div>
                {ctx.slZone && (
                  <div className="flex items-start justify-between gap-2">
                    <div className="shrink-0 space-y-0.5">
                      <div className="text-[9px] font-mono text-radar-dim uppercase tracking-wider">
                        SL ZONE
                      </div>
                      <div className="text-[8px] font-mono text-red-400/60">
                        {ctx.entryBias === "LONG"
                          ? "BELOW CLUSTER SUPPORT"
                          : ctx.isOverheadVacuumShort
                            ? "ABOVE VACUUM TOP"
                            : "ABOVE CLUSTER RESISTANCE"}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-red-400 text-right">
                      {formatZone(ctx.slZone)}
                    </span>
                  </div>
                )}
                {ctx.tp1Zone && (
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[9px] font-mono text-radar-dim uppercase tracking-wider shrink-0">
                      TP1 ZONE
                    </span>
                    <span className="text-[10px] font-mono text-radar-cyan text-right">
                      {formatZone(ctx.tp1Zone)}
                    </span>
                  </div>
                )}
                {ctx.tp2Zone && (
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[9px] font-mono text-radar-dim uppercase tracking-wider shrink-0">
                      TP2 ZONE
                    </span>
                    <span className="text-[10px] font-mono text-radar-cyan/70 text-right">
                      {formatZone(ctx.tp2Zone)}
                    </span>
                  </div>
                )}
              </>
            )}

            {/* Neutral / no setup */}
            {!isInvalid &&
              !isBiasNoExec &&
              !isValidExec &&
              !isNoCleanEntry &&
              !isNoAggrCluster && (
                <div className="flex items-center gap-2 py-0.5">
                  <span className="text-[10px] font-mono text-radar-dim opacity-60">
                    NO CLEAN ENTRY ZONE
                  </span>
                </div>
              )}
          </div>

          {/* Alignment score bar — always visible */}
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono text-radar-dim uppercase tracking-wider shrink-0">
              ALIGNMENT {ctx.alignmentScore}/6
            </span>
            <div className="flex gap-0.5 flex-1">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="flex-1 h-1 rounded-sm"
                  style={{
                    background:
                      i < ctx.alignmentScore
                        ? alignmentBarColor
                        : "oklch(0.25 0.02 210)",
                  }}
                />
              ))}
            </div>
          </div>

          {/* Interpretation line — aggression-anchored */}
          <div className="pt-1 border-t border-white/5">
            <p
              className={`text-[10px] font-mono italic leading-snug ${
                isNoCleanEntry
                  ? "text-amber-400/70"
                  : isBiasNoExec
                    ? "text-amber-400/70"
                    : isInvalid
                      ? "text-red-400/70"
                      : "text-radar-dim/80"
              }`}
            >
              {ctx.interpretationLine}
            </p>
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
