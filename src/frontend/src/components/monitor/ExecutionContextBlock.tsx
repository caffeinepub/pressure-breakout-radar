import { useState } from "react";
import type { PersistentExecutionState } from "../../executionStateMachine";
import { getMachineStateLabel } from "../../executionStateMachine";
import type { ExecutionContext } from "../../types";

interface ExecutionContextBlockProps {
  ctx: ExecutionContext | null;
  machineState?: PersistentExecutionState | null;
}

function formatPrice(p: number): string {
  if (p >= 1000) return p.toFixed(1);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

function formatZone(z: { start: number; end: number }): string {
  return `${formatPrice(z.start)} — ${formatPrice(z.end)}`;
}

function formatMs(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

// ─── MACHINE STATE BADGE ─────────────────────────────────────────────────────────────────────────

import type { ExecutionMachineState as MachineStateName } from "../../executionStateMachine";

function MachineBadge({ state }: { state: MachineStateName }) {
  const map: Record<MachineStateName, { cls: string }> = {
    NO_SETUP: {
      cls: "text-radar-dim border-[oklch(0.35_0.02_210/40%)] bg-[oklch(0.20_0.02_210/30%)]",
    },
    BUILDING: {
      cls: "text-[oklch(0.75_0.14_60)] border-[oklch(0.72_0.15_60/35%)] bg-[oklch(0.72_0.15_60/10%)]",
    },
    READY: {
      cls: "text-radar-cyan border-[oklch(0.78_0.13_195/50%)] bg-[oklch(0.78_0.13_195/12%)]",
    },
    ACTIVE: {
      cls: "text-radar-green border-[oklch(0.72_0.17_145/50%)] bg-[oklch(0.72_0.17_145/15%)]",
    },
    INVALIDATED: {
      cls: "text-red-400 border-[oklch(0.65_0.20_25/45%)] bg-[oklch(0.65_0.20_25/12%)]",
    },
    TP1_HIT: {
      cls: "text-[oklch(0.80_0.16_195)] border-[oklch(0.80_0.16_195/50%)] bg-[oklch(0.80_0.16_195/12%)]",
    },
    TP2_HIT: {
      cls: "text-[oklch(0.85_0.18_150)] border-[oklch(0.85_0.18_150/50%)] bg-[oklch(0.85_0.18_150/15%)]",
    },
  };
  const entry = map[state] ?? map.NO_SETUP;
  return (
    <span
      className={`text-[9px] font-bold font-mono px-2 py-0.5 rounded border ${entry.cls}`}
    >
      {getMachineStateLabel(state)}
    </span>
  );
}

function DirectionBadge({ dir }: { dir: "LONG" | "SHORT" | null }) {
  if (!dir) return null;
  return (
    <span
      className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border ${
        dir === "LONG"
          ? "text-radar-green border-[oklch(0.72_0.17_145/30%)] bg-[oklch(0.72_0.17_145/10%)]"
          : "text-red-400 border-[oklch(0.65_0.20_25/30%)] bg-[oklch(0.65_0.20_25/10%)]"
      }`}
    >
      {dir}
    </span>
  );
}

// ─── LEGACY DIRECTIONAL BADGE (for ctx-only fallback) ──────────────────────────────────

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
    RECLAIM_LONG: {
      label: "RECLAIM LONG",
      cls: "text-[oklch(0.78_0.18_150)] bg-[oklch(0.72_0.17_145/12%)] border-[oklch(0.72_0.17_145/35%)]",
    },
    RECLAIM_SHORT: {
      label: "RECLAIM SHORT",
      cls: "text-[oklch(0.72_0.20_30)] bg-[oklch(0.65_0.20_25/12%)] border-[oklch(0.65_0.20_25/35%)]",
    },
    RECLAIM_LONG_WAIT_RETEST: {
      label: "RECLAIM / WAIT RETEST",
      cls: "text-amber-400 bg-[oklch(0.72_0.15_60/10%)] border-[oklch(0.72_0.15_60/30%)]",
    },
    RECLAIM_SHORT_WAIT_RETEST: {
      label: "RECLAIM / WAIT RETEST",
      cls: "text-amber-400 bg-[oklch(0.72_0.15_60/10%)] border-[oklch(0.72_0.15_60/30%)]",
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

// ─── MACHINE STATE HEADER BLOCK ─────────────────────────────────────────────────────────────────

function getMachineStateAccentColor(state: MachineStateName): string {
  switch (state) {
    case "READY":
      return "oklch(0.78 0.13 195 / 25%)";
    case "ACTIVE":
      return "oklch(0.72 0.17 145 / 25%)";
    case "TP1_HIT":
      return "oklch(0.80 0.16 195 / 20%)";
    case "TP2_HIT":
      return "oklch(0.85 0.18 150 / 25%)";
    case "INVALIDATED":
      return "oklch(0.65 0.20 25 / 18%)";
    case "BUILDING":
      return "oklch(0.72 0.15 60 / 15%)";
    default:
      return "transparent";
  }
}

function MachineStateBlock({ ms }: { ms: PersistentExecutionState }) {
  const state = ms.state;
  const accentColor = getMachineStateAccentColor(state);

  const isActiveOrBetter =
    state === "ACTIVE" || state === "TP1_HIT" || state === "TP2_HIT";
  const isReady = state === "READY";
  const isBuilding = state === "BUILDING";
  const isInvalidated = state === "INVALIDATED";
  const isCompleted = state === "TP2_HIT";

  // Entry zone source: frozen when READY or beyond
  const showFrozenZones =
    (isReady || isActiveOrBetter) && ms.entryZone && ms.slZone && ms.tp1Zone;
  const showFaintZones = isBuilding && ms.entryZone;

  return (
    <div
      className="rounded-xl border border-white/8 overflow-hidden"
      style={{ background: accentColor }}
    >
      {/* State header */}
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <div className="flex items-center gap-1.5">
          <MachineBadge state={state} />
          {ms.direction && <DirectionBadge dir={ms.direction} />}
          {ms.rewardRisk > 0 && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-[oklch(0.78_0.13_195/20%)] text-radar-dim">
              {ms.rewardRisk.toFixed(1)}R
            </span>
          )}
        </div>
        <span className="text-[8px] font-mono text-radar-dim/50">
          {formatMs(ms.stateAgeMs)}
        </span>
      </div>

      {/* State-specific content */}
      {isCompleted && (
        <div className="px-2.5 pb-2">
          <div className="flex items-center gap-1.5 py-1 px-2 rounded-lg bg-[oklch(0.85_0.18_150/12%)] border border-[oklch(0.85_0.18_150/25%)]">
            <span className="text-[oklch(0.85_0.18_150)] text-[14px] leading-none">
              ✓✓
            </span>
            <div className="space-y-0.5">
              <div className="text-[10px] font-bold font-mono text-[oklch(0.85_0.18_150)]">
                FULL TARGET REACHED
              </div>
              <div className="text-[8px] font-mono text-radar-dim/50">
                TP1 + TP2 BOTH HIT — SETUP COMPLETE
              </div>
            </div>
          </div>
        </div>
      )}

      {state === "TP1_HIT" && (
        <div className="px-2.5 pb-2">
          <div className="flex items-center gap-1.5 py-1 px-2 rounded-lg bg-[oklch(0.80_0.16_195/10%)] border border-[oklch(0.80_0.16_195/25%)]">
            <span className="text-[oklch(0.80_0.16_195)] text-[14px] leading-none">
              ✓
            </span>
            <div className="space-y-0.5">
              <div className="text-[10px] font-bold font-mono text-[oklch(0.80_0.16_195)]">
                TP1 REACHED — HOLDING FOR TP2
              </div>
              {ms.tp2Zone ? (
                <div className="text-[8px] font-mono text-radar-dim/50">
                  TP2 TARGET: {formatZone(ms.tp2Zone)}
                </div>
              ) : (
                <div className="text-[8px] font-mono text-radar-dim/50">
                  NO TP2 DEFINED
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {state === "ACTIVE" && (
        <div className="px-2.5 pb-2">
          <div className="flex items-center gap-1.5 py-1 px-2 rounded-lg bg-[oklch(0.72_0.17_145/10%)] border border-[oklch(0.72_0.17_145/25%)]">
            <span className="text-radar-green text-[12px] leading-none animate-pulse">
              ●
            </span>
            <div className="space-y-0.5">
              <div className="text-[10px] font-bold font-mono text-radar-green">
                TRADE ACTIVE — ZONES LOCKED
              </div>
              <div className="text-[8px] font-mono text-radar-dim/50">
                TRIGGERED @{" "}
                {ms.triggerPrice ? formatPrice(ms.triggerPrice) : "—"}
              </div>
            </div>
          </div>
        </div>
      )}

      {isInvalidated && (
        <div className="px-2.5 pb-2">
          <div className="flex items-center gap-1.5 py-1 px-2 rounded-lg bg-red-500/8 border border-red-500/20">
            <span className="text-red-400 text-[13px] leading-none">⚠️</span>
            <div className="space-y-0.5">
              <div className="text-[10px] font-bold font-mono text-red-400">
                {ms.invalidationReason?.replace(/_/g, " ") ??
                  "SETUP INVALIDATED"}
              </div>
              <div className="text-[8px] font-mono text-radar-dim/50">
                FADING — NEW SETUP BUILDING SHORTLY
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Frozen execution zones — visible when READY / ACTIVE / TP1_HIT / TP2_HIT */}
      {showFrozenZones && (
        <div className="px-2.5 pb-2.5 space-y-1.5 border-t border-white/5 pt-1.5">
          {isReady && (
            <div className="text-[8px] font-mono text-radar-dim/50 uppercase tracking-wider mb-1">
              FROZEN SETUP ZONES
            </div>
          )}
          <div className="flex items-start justify-between gap-2">
            <div className="shrink-0 space-y-0.5">
              <div className="text-[9px] font-mono text-radar-dim uppercase tracking-wider">
                ENTRY
              </div>
              <div className="text-[8px] font-mono text-radar-dim/40">
                {state === "ACTIVE"
                  ? "LOCKED"
                  : state === "READY"
                    ? "PENDING TRIGGER"
                    : ""}
              </div>
            </div>
            <span
              className={`text-[10px] font-mono text-right ${
                ms.direction === "LONG" ? "text-radar-green" : "text-red-400"
              }`}
            >
              {formatZone(ms.entryZone!)}
            </span>
          </div>
          {ms.slZone && (
            <div className="flex items-start justify-between gap-2">
              <div className="shrink-0 space-y-0.5">
                <div className="text-[9px] font-mono text-radar-dim uppercase tracking-wider">
                  SL
                </div>
                <div className="text-[8px] font-mono text-red-400/40">
                  INVALIDATION
                </div>
              </div>
              <span className="text-[10px] font-mono text-red-400 text-right">
                {formatZone(ms.slZone)}
              </span>
            </div>
          )}
          {ms.tp1Zone && (
            <div className="flex items-start justify-between gap-2">
              <span
                className={`text-[9px] font-mono uppercase tracking-wider shrink-0 ${
                  state === "TP1_HIT" || state === "TP2_HIT"
                    ? "text-radar-cyan"
                    : "text-radar-dim"
                }`}
              >
                TP1 {state === "TP1_HIT" || state === "TP2_HIT" ? "✓" : ""}
              </span>
              <span
                className={`text-[10px] font-mono text-right ${
                  state === "TP1_HIT" || state === "TP2_HIT"
                    ? "text-radar-cyan"
                    : "text-radar-cyan/70"
                }`}
              >
                {formatZone(ms.tp1Zone)}
              </span>
            </div>
          )}
          {ms.tp2Zone && (
            <div className="flex items-start justify-between gap-2">
              <span
                className={`text-[9px] font-mono uppercase tracking-wider shrink-0 ${
                  state === "TP2_HIT" ? "text-radar-cyan" : "text-radar-dim"
                }`}
              >
                TP2 {state === "TP2_HIT" ? "✓" : ""}
              </span>
              <span
                className={`text-[10px] font-mono text-right ${
                  state === "TP2_HIT" ? "text-radar-cyan" : "text-radar-cyan/50"
                }`}
              >
                {formatZone(ms.tp2Zone)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* BUILDING — faint projected zones */}
      {showFaintZones && (
        <div className="px-2.5 pb-2.5 space-y-1.5 border-t border-white/5 pt-1.5 opacity-60">
          <div className="text-[8px] font-mono text-radar-dim/50 uppercase tracking-wider mb-1">
            PROJECTED ZONES (FORMING)
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] font-mono text-radar-dim">ENTRY</span>
            <span className="text-[10px] font-mono text-radar-dim/70 text-right">
              {formatZone(ms.entryZone!)}
            </span>
          </div>
          {ms.slZone && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] font-mono text-radar-dim">SL</span>
              <span className="text-[10px] font-mono text-red-400/50 text-right">
                {formatZone(ms.slZone)}
              </span>
            </div>
          )}
          {ms.tp1Zone && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] font-mono text-radar-dim">TP1</span>
              <span className="text-[10px] font-mono text-radar-cyan/50 text-right">
                {formatZone(ms.tp1Zone)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── DEBUG BLOCK ─────────────────────────────────────────────────────────────────────────────

function MachineDebugBlock({ ms }: { ms: PersistentExecutionState }) {
  return (
    <div className="mt-2 p-2.5 rounded-xl border border-white/6 bg-white/2 space-y-1.5">
      <div className="text-[8px] font-mono text-radar-dim/50 uppercase tracking-wider mb-1">
        STATE MACHINE DEBUG
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[8px] font-mono">
        <span className="text-radar-dim/60">State</span>
        <span className="text-radar-cyan font-bold">{ms.state}</span>
        <span className="text-radar-dim/60">Prev State</span>
        <span className="text-radar-dim">{ms.previousState}</span>
        <span className="text-radar-dim/60">Source</span>
        <span
          className={
            ms.source === "LIVE"
              ? "text-radar-green"
              : ms.source === "LAST_KNOWN_GOOD"
                ? "text-amber-400"
                : "text-red-400/70"
          }
        >
          {ms.source}
        </span>
        <span className="text-radar-dim/60">State age</span>
        <span className="text-radar-dim">{formatMs(ms.stateAgeMs)}</span>
        {ms.setupId && (
          <>
            <span className="text-radar-dim/60">Setup ID</span>
            <span
              className="text-radar-dim/70 break-all"
              style={{ wordBreak: "break-all", fontSize: "7px" }}
            >
              {ms.setupId.slice(-28)}
            </span>
          </>
        )}
        <span className="text-radar-dim/60">RR</span>
        <span className="text-radar-dim">
          {ms.rewardRisk > 0 ? `${ms.rewardRisk.toFixed(2)}R` : "—"}
        </span>
        {ms.invalidationReason && (
          <>
            <span className="text-radar-dim/60">Inv. reason</span>
            <span className="text-red-400/80">{ms.invalidationReason}</span>
          </>
        )}
        {ms.buildingCycles > 0 && (
          <>
            <span className="text-radar-dim/60">Build cycles</span>
            <span className="text-radar-dim">{ms.buildingCycles}</span>
          </>
        )}
        {ms.readyCycles > 0 && (
          <>
            <span className="text-radar-dim/60">Ready cycles</span>
            <span className="text-radar-dim">{ms.readyCycles}</span>
          </>
        )}
        <span className="text-radar-dim/60">Version</span>
        <span className="text-radar-dim">{ms.version}</span>

        {/* Overlap / separation / conservative RR */}
        {ms.overlapExists !== undefined && (
          <>
            <span className="text-radar-dim/60">Overlap</span>
            <span
              className={
                ms.overlapExists ? "text-red-400 font-bold" : "text-radar-green"
              }
            >
              {ms.overlapExists ? "YES ⛔" : "NO ✓"}
            </span>
          </>
        )}
        {ms.separationDistance !== undefined && (
          <>
            <span className="text-radar-dim/60">Separation</span>
            <span
              className={
                ms.separationDistance !== undefined &&
                ms.minimumRequiredSeparation !== undefined &&
                ms.separationDistance < ms.minimumRequiredSeparation
                  ? "text-amber-400"
                  : "text-radar-dim"
              }
            >
              {ms.separationDistance?.toFixed(4)} / min{" "}
              {ms.minimumRequiredSeparation?.toFixed(4)}
            </span>
          </>
        )}
        {ms.conservativeRR !== undefined && (
          <>
            <span className="text-radar-dim/60">Consv. RR</span>
            <span
              className={
                ms.conservativeRR !== undefined && ms.conservativeRR < 1.8
                  ? "text-amber-400"
                  : "text-radar-green"
              }
            >
              {ms.conservativeRR?.toFixed(2)}R
            </span>
          </>
        )}
        {ms.readyBlockReason && (
          <>
            <span className="text-radar-dim/60">Block</span>
            <span className="text-red-400 font-bold text-[7px]">
              {ms.readyBlockReason.replace(/_/g, " ")}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────────────────────

export function ExecutionContextBlock({
  ctx,
  machineState,
}: ExecutionContextBlockProps) {
  const [debugOpen, setDebugOpen] = useState(false);

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
  const isReclaimValid =
    execValidity === "RECLAIM_LONG" || execValidity === "RECLAIM_SHORT";
  const isReclaimWait =
    execValidity === "RECLAIM_LONG_WAIT_RETEST" ||
    execValidity === "RECLAIM_SHORT_WAIT_RETEST";

  const alignmentBarColor = isReclaimValid
    ? execValidity === "RECLAIM_LONG"
      ? "oklch(0.72 0.17 145 / 80%)"
      : "oklch(0.65 0.20 25 / 80%)"
    : isInvalid && !isBiasNoExec && !isNoCleanEntry
      ? "oklch(0.65 0.20 25 / 60%)"
      : isBiasNoExec || isNoCleanEntry || isReclaimWait
        ? "oklch(0.72 0.15 60 / 70%)"
        : ctx?.executionQuality === "HIGH"
          ? "oklch(0.72 0.17 145)"
          : ctx?.executionQuality === "MEDIUM"
            ? "oklch(0.75 0.15 75)"
            : "oklch(0.65 0.20 25)";

  const hasMachine = machineState != null;
  const msState = machineState?.state;

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
        {ctx && !hasMachine && (
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <DirectionalBadge state={ctx.directionalState ?? "NO_CLEAR"} />
            <ValidityBadge state={execValidity} isInvalid={isInvalid} />
            {isValidExec && ctx.rMultiple != null && ctx.rMultiple > 0 && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-[oklch(0.78_0.13_195/20%)] text-radar-dim">
                {ctx.rMultiple.toFixed(1)}R
              </span>
            )}
          </div>
        )}
      </div>

      {/* ─── MACHINE STATE BLOCK (primary, shown when available) */}
      {hasMachine && <MachineStateBlock ms={machineState!} />}

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
              {isReclaimValid || isReclaimWait
                ? execValidity === "RECLAIM_LONG" ||
                  execValidity === "RECLAIM_LONG_WAIT_RETEST"
                  ? "FAILED SELLER ZONE"
                  : "FAILED BUYER ZONE"
                : isOverheadVacuumShort
                  ? "OVERHEAD (RESISTANCE)"
                  : ctx.entryBias === "LONG"
                    ? "ABOVE"
                    : ctx.entryBias === "SHORT"
                      ? "BELOW"
                      : "CHECK CHART"}
            </span>
          </div>

          {/* Only show execution details if NO machine state or machine state is BUILDING/NO_SETUP */}
          {(!hasMachine ||
            msState === "BUILDING" ||
            msState === "NO_SETUP") && (
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

              {/* RECLAIM WAIT FOR RETEST */}
              {isReclaimWait && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-amber-500/8 border border-amber-500/20">
                    <span className="text-amber-400 text-[14px] leading-none">
                      ⏳
                    </span>
                    <div className="space-y-0.5">
                      <div className="text-[10px] font-bold font-mono text-amber-400">
                        {execValidity === "RECLAIM_LONG_WAIT_RETEST"
                          ? "RECLAIM LONG / WAIT FOR RETEST"
                          : "RECLAIM SHORT / WAIT FOR RETEST"}
                      </div>
                      <div className="text-[8px] font-mono text-amber-400/60">
                        PRICE EXTENDED — WAIT FOR RETEST TO FAILED AGGRESSION
                        ZONE
                      </div>
                    </div>
                  </div>
                  {execValidity === "RECLAIM_LONG_WAIT_RETEST" &&
                    ctx.idealLongEntryZone && (
                      <div className="flex items-start justify-between gap-2 opacity-60">
                        <div className="shrink-0 space-y-0.5">
                          <div className="text-[9px] font-mono text-radar-green/70 uppercase tracking-wider">
                            RECLAIM ZONE
                          </div>
                          <div className="text-[8px] font-mono text-radar-dim/50">
                            FAILED SELLER AGGRESSION
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-radar-green/70 text-right">
                          {formatZone(ctx.idealLongEntryZone)}
                        </span>
                      </div>
                    )}
                  {execValidity === "RECLAIM_SHORT_WAIT_RETEST" &&
                    ctx.idealShortEntryZone && (
                      <div className="flex items-start justify-between gap-2 opacity-60">
                        <div className="shrink-0 space-y-0.5">
                          <div className="text-[9px] font-mono text-red-400/70 uppercase tracking-wider">
                            RECLAIM ZONE
                          </div>
                          <div className="text-[8px] font-mono text-radar-dim/50">
                            FAILED BUYER AGGRESSION
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-red-400/70 text-right">
                          {formatZone(ctx.idealShortEntryZone)}
                        </span>
                      </div>
                    )}
                </div>
              )}

              {/* VALID RECLAIM ENTRY */}
              {isReclaimValid && ctx.entryZone && (
                <>
                  <div className="flex items-center gap-2 py-1 px-2 rounded-lg bg-[oklch(0.72_0.15_60/8%)] border border-[oklch(0.72_0.15_60/20%)]">
                    <span className="text-[13px] leading-none">
                      {execValidity === "RECLAIM_LONG" ? "↑" : "↓"}
                    </span>
                    <div className="space-y-0.5">
                      <div
                        className={`text-[10px] font-bold font-mono ${execValidity === "RECLAIM_LONG" ? "text-radar-green" : "text-red-400"}`}
                      >
                        {execValidity === "RECLAIM_LONG"
                          ? "FAILED SELLER AGGRESSION RECLAIMED"
                          : "FAILED BUYER AGGRESSION LOST"}
                      </div>
                      <div className="text-[8px] font-mono text-radar-dim/50">
                        {execValidity === "RECLAIM_LONG"
                          ? "RECLAIM CONFIRMED — INVALIDATION BELOW FAILED ZONE"
                          : "RECLAIM CONFIRMED — INVALIDATION ABOVE FAILED ZONE"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="shrink-0 space-y-0.5">
                      <div className="text-[9px] font-mono text-radar-dim uppercase tracking-wider">
                        ENTRY ZONE
                      </div>
                      <div className="text-[8px] font-mono text-radar-dim/50">
                        {execValidity === "RECLAIM_LONG"
                          ? "FAILED BEARISH AGGRESSION ZONE"
                          : "FAILED BULLISH AGGRESSION ZONE"}
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-mono text-right ${execValidity === "RECLAIM_LONG" ? "text-radar-green" : "text-red-400"}`}
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
                          {execValidity === "RECLAIM_LONG"
                            ? "BELOW FAILED AGGRESSION ZONE"
                            : "ABOVE FAILED AGGRESSION ZONE"}
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

              {/* NO CLEAN ENTRY */}
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

              {/* BIAS but no valid execution */}
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

              {/* INVALID execution */}
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
                      Direction is aligned but reward structure is
                      mathematically inconsistent. No valid entry model can be
                      drawn.
                    </p>
                  </div>
                )}

              {/* VALID execution zones */}
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
                      className={`text-[10px] font-mono text-right ${ctx.entryBias === "LONG" ? "text-radar-green" : "text-red-400"}`}
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
                !isNoAggrCluster &&
                !isReclaimValid &&
                !isReclaimWait && (
                  <div className="flex items-center gap-2 py-0.5">
                    <span className="text-[10px] font-mono text-radar-dim opacity-60">
                      NO CLEAN ENTRY ZONE
                    </span>
                  </div>
                )}
            </div>
          )}

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

          {/* Interpretation line */}
          <div className="pt-1 border-t border-white/5">
            <p
              className={`text-[10px] font-mono italic leading-snug ${
                isReclaimValid
                  ? execValidity === "RECLAIM_LONG"
                    ? "text-radar-green/70"
                    : "text-red-400/70"
                  : isReclaimWait || isNoCleanEntry
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

          {/* Machine state debug — collapsible */}
          {hasMachine && (
            <div>
              <button
                type="button"
                onClick={() => setDebugOpen((o) => !o)}
                className="text-[8px] font-mono text-radar-dim/40 hover:text-radar-dim/70 transition-colors uppercase tracking-wider"
              >
                {debugOpen ? "▼" : "►"} STATE MACHINE DEBUG
              </button>
              {debugOpen && <MachineDebugBlock ms={machineState!} />}
            </div>
          )}
        </div>
      ) : (
        <div className="text-[13px] font-mono text-radar-dim animate-pulse">
          CALCULATING...
        </div>
      )}
    </div>
  );
}
