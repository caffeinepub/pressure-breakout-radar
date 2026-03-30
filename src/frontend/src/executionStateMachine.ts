/**
 * Execution State Machine V1
 * Persistent, state-based execution model per symbol + timeframe.
 * Replaces tick-fragile overlay logic with deterministic state transitions.
 */

import type { ExecutionContext, ExecutionZone } from "./types";

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type ExecutionMachineState =
  | "NO_SETUP"
  | "BUILDING"
  | "READY"
  | "ACTIVE"
  | "INVALIDATED"
  | "TP1_HIT"
  | "TP2_HIT";

export type InvalidationReason =
  | "HARD_RANGE_BREAK"
  | "VACUUM_FLIP_INVALIDATION"
  | "SL_STRUCTURE_BROKEN"
  | "REWARD_RISK_TOO_LOW"
  | "DIRECTION_LOST"
  | "DATA_TIMEOUT_CONFIRMED"
  | null;

export interface PersistentExecutionState {
  // Core state
  state: ExecutionMachineState;
  previousState: ExecutionMachineState;
  direction: "LONG" | "SHORT" | null;

  // Timestamps
  createdAt: number;
  updatedAt: number;

  // Frozen execution zones (locked when entering READY)
  entryZone: ExecutionZone | null;
  slZone: ExecutionZone | null;
  tp1Zone: ExecutionZone | null;
  tp2Zone: ExecutionZone | null;

  // Metadata
  invalidationReason: InvalidationReason;
  rewardRisk: number;
  setupId: string;
  triggerPrice: number | null;
  tp1HitAt: number | null;
  tp2HitAt: number | null;
  invalidatedAt: number | null;
  version: number;

  // Anti-flicker persistence counters
  buildingCycles: number;
  readyCycles: number;
  // INVALIDATED fade counter — how long since invalidation
  invalidatedFadeMs: number;

  // Debug fields
  source: "LIVE" | "LAST_KNOWN_GOOD" | "STALE_HOLD";
  stateAgeMs: number;
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

// Minimum RR to enter READY state (same across all timeframes)
const MIN_READY_RR = 1.8;

// ─── TIMEFRAME-SCALED CONSTANTS ───────────────────────────────────────────────

interface TfConstants {
  MIN_BUILDING_CYCLES: number;
  MIN_READY_CYCLES: number;
  MIN_READY_MS: number;
  MACHINE_STATE_TTL_MS: number;
  INVALIDATED_FADE_MS: number;
  DATA_TIMEOUT_MS: number;
  SL_TOLERANCE_MULTIPLIER: number;
}

function getTfConstants(timeframe: string): TfConstants {
  if (timeframe === "15m") {
    return {
      MIN_BUILDING_CYCLES: 4,
      MIN_READY_CYCLES: 8,
      MIN_READY_MS: 12_000,
      MACHINE_STATE_TTL_MS: 45_000,
      INVALIDATED_FADE_MS: 6_000,
      DATA_TIMEOUT_MS: 120_000,
      SL_TOLERANCE_MULTIPLIER: 1.5,
    };
  }
  if (timeframe === "5m") {
    return {
      MIN_BUILDING_CYCLES: 3,
      MIN_READY_CYCLES: 6,
      MIN_READY_MS: 6_000,
      MACHINE_STATE_TTL_MS: 20_000,
      INVALIDATED_FADE_MS: 4_000,
      DATA_TIMEOUT_MS: 60_000,
      SL_TOLERANCE_MULTIPLIER: 1.1,
    };
  }
  // 1m (default)
  return {
    MIN_BUILDING_CYCLES: 3,
    MIN_READY_CYCLES: 5,
    MIN_READY_MS: 5_000,
    MACHINE_STATE_TTL_MS: 15_000,
    INVALIDATED_FADE_MS: 3_500,
    DATA_TIMEOUT_MS: 30_000,
    SL_TOLERANCE_MULTIPLIER: 1.0,
  };
}

// ─── MODULE-SCOPE STATE ───────────────────────────────────────────────────────

/** Last known good state per symbol+timeframe */
export const lastKnownGoodExecutionMap = new Map<
  string,
  { state: PersistentExecutionState; ts: number }
>();

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function zoneMid(z: ExecutionZone): number {
  return (z.start + z.end) / 2;
}

function priceInZone(price: number, zone: ExecutionZone): boolean {
  return price >= zone.start && price <= zone.end;
}

function computeRR(
  direction: "LONG" | "SHORT",
  entryZone: ExecutionZone,
  slZone: ExecutionZone,
  tp1Zone: ExecutionZone,
): number {
  const entryMid = zoneMid(entryZone);
  const slMid = zoneMid(slZone);
  const tp1Mid = zoneMid(tp1Zone);
  const R =
    direction === "LONG"
      ? Math.max(entryMid - slMid, entryMid * 0.001)
      : Math.max(slMid - entryMid, entryMid * 0.001);
  const reward = direction === "LONG" ? tp1Mid - entryMid : entryMid - tp1Mid;
  return R > 0 ? reward / R : 0;
}

/**
 * Generate a deterministic setupId from structure.
 * Changes when direction changes or entry/SL zones shift materially.
 */
function buildSetupId(
  symbol: string,
  timeframe: string,
  direction: "LONG" | "SHORT",
  entryZone: ExecutionZone,
  slZone: ExecutionZone,
): string {
  // Coarse bucket: 5-minute time window to avoid constant ID churn
  const timeBucket = Math.floor(Date.now() / 300_000);
  // Price-level hash: round to nearest 0.1% of entry mid
  const entryMid = zoneMid(entryZone);
  const slMid = zoneMid(slZone);
  const entryHash = Math.round(entryMid * 1000) / 1000;
  const slHash = Math.round(slMid * 1000) / 1000;
  return `${symbol}_${timeframe}_${direction}_${timeBucket}_${entryHash}_${slHash}`;
}

/** Check if zones have changed materially (> 1% shift in either mid) */
function zonesChangedMaterially(
  a: ExecutionZone,
  b: ExecutionZone,
  refPrice: number,
): boolean {
  const threshold = refPrice * 0.01; // 1% of reference price
  return Math.abs(zoneMid(a) - zoneMid(b)) > threshold;
}

// ─── HARD INVALIDATION CHECKS ────────────────────────────────────────────────

/**
 * Checks if current execution context constitutes a hard invalidation
 * of a previously READY/ACTIVE/TP1_HIT setup.
 * Only returns a reason for REAL structural breaks — not noise.
 */
function checkHardInvalidation(
  persisted: PersistentExecutionState,
  ctx: ExecutionContext | null,
  currentPrice: number,
  tfConstants: TfConstants,
): InvalidationReason {
  // Data timeout — no valid update for a long time
  if (Date.now() - persisted.updatedAt > tfConstants.DATA_TIMEOUT_MS) {
    return "DATA_TIMEOUT_CONFIRMED";
  }

  if (!ctx) return null; // No context — preserve state (could be transient)

  // Direction completely lost or flipped
  const isBiasFlipped =
    (persisted.direction === "LONG" &&
      (ctx.entryBias === "SHORT" || ctx.directionalState === "FULL_SHORT")) ||
    (persisted.direction === "SHORT" &&
      (ctx.entryBias === "LONG" || ctx.directionalState === "FULL_LONG"));

  if (isBiasFlipped) return "DIRECTION_LOST";

  // SL structure broken — price penetrated the SL zone
  // 15m uses a tolerance buffer to avoid nervous invalidation on thin probes
  if (persisted.slZone) {
    const slZoneWidth = persisted.slZone.end - persisted.slZone.start;
    const slTolerance =
      slZoneWidth * (tfConstants.SL_TOLERANCE_MULTIPLIER - 1.0);
    if (
      persisted.direction === "LONG" &&
      currentPrice < persisted.slZone.start - slTolerance
    ) {
      return "SL_STRUCTURE_BROKEN";
    }
    if (
      persisted.direction === "SHORT" &&
      currentPrice > persisted.slZone.end + slTolerance
    ) {
      return "SL_STRUCTURE_BROKEN";
    }
  }

  return null;
}

/**
 * Checks for hard invalidation from READY state specifically.
 * Slightly more lenient than ACTIVE invalidation.
 */
function checkReadyInvalidation(
  persisted: PersistentExecutionState,
  ctx: ExecutionContext | null,
  currentPrice: number,
  tfConstants: TfConstants,
): InvalidationReason {
  // Core invalidation checks
  const base = checkHardInvalidation(persisted, ctx, currentPrice, tfConstants);
  if (base) return base;

  if (!ctx) return null;

  // Reward/risk dropped below minimum (only if we can measure it)
  if (
    persisted.entryZone &&
    persisted.slZone &&
    persisted.tp1Zone &&
    persisted.direction
  ) {
    const rr = computeRR(
      persisted.direction,
      persisted.entryZone,
      persisted.slZone,
      persisted.tp1Zone,
    );
    if (rr < MIN_READY_RR) return "REWARD_RISK_TOO_LOW";
  }

  return null;
}

// ─── EXTRACT SETUP FROM EXECUTION CONTEXT ────────────────────────────────────

interface ExtractedSetup {
  direction: "LONG" | "SHORT";
  entryZone: ExecutionZone;
  slZone: ExecutionZone;
  tp1Zone: ExecutionZone;
  tp2Zone: ExecutionZone | null;
  rr: number;
  isValid: boolean;
}

function extractValidSetup(ctx: ExecutionContext): ExtractedSetup | null {
  const validStates = [
    "VALID_LONG",
    "VALID_SHORT",
    "RECLAIM_LONG",
    "RECLAIM_SHORT",
  ];
  if (!validStates.includes(ctx.executionValidityState)) return null;
  if (!ctx.entryZone || !ctx.slZone || !ctx.tp1Zone) return null;

  const direction: "LONG" | "SHORT" =
    ctx.executionValidityState === "VALID_LONG" ||
    ctx.executionValidityState === "RECLAIM_LONG"
      ? "LONG"
      : "SHORT";

  const rr = computeRR(direction, ctx.entryZone, ctx.slZone, ctx.tp1Zone);
  return {
    direction,
    entryZone: ctx.entryZone,
    slZone: ctx.slZone,
    tp1Zone: ctx.tp1Zone,
    tp2Zone: ctx.tp2Zone ?? null,
    rr,
    isValid: rr >= MIN_READY_RR,
  };
}

/** Returns true if the execution context has meaningful alignment forming */
function isConditionsBuilding(ctx: ExecutionContext): boolean {
  // Conditions are building if there's directional lean or better
  const buildingStates = [
    "FULL_LONG",
    "FULL_SHORT",
    "LONG_LEAN",
    "SHORT_LEAN",
    "VALID_LONG",
    "VALID_SHORT",
    "RECLAIM_LONG",
    "RECLAIM_SHORT",
    "LONG_BIAS_NO_CLEAN_ENTRY",
    "SHORT_BIAS_NO_CLEAN_ENTRY",
    "LONG_BIAS_NO_EXEC",
    "SHORT_BIAS_NO_EXEC",
    "RECLAIM_LONG_WAIT_RETEST",
    "RECLAIM_SHORT_WAIT_RETEST",
  ];
  return (
    buildingStates.includes(ctx.executionValidityState) ||
    buildingStates.includes(ctx.directionalState) ||
    ctx.alignmentScore >= 3
  );
}

// ─── DEFAULT STATE ────────────────────────────────────────────────────────────

function createNoSetupState(): PersistentExecutionState {
  const now = Date.now();
  return {
    state: "NO_SETUP",
    previousState: "NO_SETUP",
    direction: null,
    createdAt: now,
    updatedAt: now,
    entryZone: null,
    slZone: null,
    tp1Zone: null,
    tp2Zone: null,
    invalidationReason: null,
    rewardRisk: 0,
    setupId: "",
    triggerPrice: null,
    tp1HitAt: null,
    tp2HitAt: null,
    invalidatedAt: null,
    version: 0,
    buildingCycles: 0,
    readyCycles: 0,
    invalidatedFadeMs: 0,
    source: "LIVE",
    stateAgeMs: 0,
  };
}

// ─── PERSIST + LOAD ───────────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = "pbr_execution_state_";

function saveToStorage(key: string, state: PersistentExecutionState): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(state));
  } catch {
    // localStorage quota — fail silently
  }
}

function loadFromStorage(key: string): PersistentExecutionState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistentExecutionState;
    // Don't restore very old states
    if (Date.now() - parsed.updatedAt > 180_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─── MAIN ADVANCE FUNCTION ────────────────────────────────────────────────────

/**
 * Advance the execution state machine for a given symbol+timeframe.
 *
 * Called every monitor tick. Returns the new persisted state.
 * Zones are FROZEN in READY/ACTIVE/TP1_HIT/TP2_HIT — only update in BUILDING
 * or on fresh setupId.
 */
export function advanceExecutionStateMachine(
  symbol: string,
  timeframe: string,
  currentPrice: number,
  ctx: ExecutionContext | null,
): PersistentExecutionState {
  const cacheKey = `${symbol}_${timeframe}`;
  const now = Date.now();
  const tfConstants = getTfConstants(timeframe);

  // ── Load existing state ───────────────────────────────────────────────────
  let persisted = lastKnownGoodExecutionMap.get(cacheKey)?.state ?? null;

  // Bootstrap from localStorage if no in-memory state
  if (!persisted) {
    persisted = loadFromStorage(cacheKey);
  }

  if (!persisted) {
    persisted = createNoSetupState();
  }

  // ── Compute state age ─────────────────────────────────────────────────────
  const stateAgeMs = now - (persisted.createdAt ?? now);

  // ── Handle null/failed context (last-known-good preservation) ────────────
  if (!ctx) {
    const timeSinceUpdate = now - persisted.updatedAt;
    if (timeSinceUpdate < tfConstants.MACHINE_STATE_TTL_MS) {
      // Preserve current state — transient missing data
      const preserved: PersistentExecutionState = {
        ...persisted,
        updatedAt: now,
        source: "LAST_KNOWN_GOOD",
        stateAgeMs,
      };
      lastKnownGoodExecutionMap.set(cacheKey, { state: preserved, ts: now });
      return preserved;
    }
    // TTL expired — return NO_SETUP
    const expired = createNoSetupState();
    lastKnownGoodExecutionMap.set(cacheKey, { state: expired, ts: now });
    return expired;
  }

  // ── Run state machine transitions ─────────────────────────────────────────
  let next: PersistentExecutionState = {
    ...persisted,
    updatedAt: now,
    source: "LIVE",
    stateAgeMs,
  };

  switch (persisted.state) {
    // ── NO_SETUP ────────────────────────────────────────────────────────────
    case "NO_SETUP": {
      if (isConditionsBuilding(ctx)) {
        next = {
          ...next,
          state: "BUILDING",
          previousState: "NO_SETUP",
          createdAt: now,
          buildingCycles: 1,
          readyCycles: 0,
          direction:
            ctx.entryBias !== "NEUTRAL"
              ? (ctx.entryBias as "LONG" | "SHORT")
              : null,
          // Store tentative zones in BUILDING for faint chart reference
          entryZone: ctx.entryZone,
          slZone: ctx.slZone,
          tp1Zone: ctx.tp1Zone,
          tp2Zone: ctx.tp2Zone ?? null,
          invalidationReason: null,
          setupId: "",
          triggerPrice: null,
          tp1HitAt: null,
          tp2HitAt: null,
          invalidatedAt: null,
          rewardRisk: ctx.rMultiple ?? 0,
        };
      }
      break;
    }

    // ── BUILDING ────────────────────────────────────────────────────────────
    case "BUILDING": {
      const buildingCycles = (persisted.buildingCycles ?? 0) + 1;
      next.buildingCycles = buildingCycles;

      // Update tentative zones while BUILDING (not frozen yet)
      next.direction =
        ctx.entryBias !== "NEUTRAL"
          ? (ctx.entryBias as "LONG" | "SHORT")
          : persisted.direction;
      next.entryZone = ctx.entryZone;
      next.slZone = ctx.slZone;
      next.tp1Zone = ctx.tp1Zone;
      next.tp2Zone = ctx.tp2Zone ?? null;
      next.rewardRisk = ctx.rMultiple ?? 0;

      const setup = extractValidSetup(ctx);

      if (setup?.isValid && buildingCycles >= tfConstants.MIN_BUILDING_CYCLES) {
        // Conditions met — transition to READY
        const setupId = buildSetupId(
          symbol,
          timeframe,
          setup.direction,
          setup.entryZone,
          setup.slZone,
        );
        next = {
          ...next,
          state: "READY",
          previousState: "BUILDING",
          createdAt: now,
          readyCycles: 1,
          direction: setup.direction,
          // FREEZE zones at READY entry
          entryZone: setup.entryZone,
          slZone: setup.slZone,
          tp1Zone: setup.tp1Zone,
          tp2Zone: setup.tp2Zone,
          rewardRisk: setup.rr,
          setupId,
        };
      } else if (!isConditionsBuilding(ctx)) {
        // Conditions dissolved — only go back to NO_SETUP if we haven't built up yet
        if (buildingCycles < tfConstants.MIN_BUILDING_CYCLES) {
          next = { ...createNoSetupState(), source: "LIVE" };
        }
        // Otherwise stay BUILDING a few more cycles
      }
      break;
    }

    // ── READY ────────────────────────────────────────────────────────────────
    case "READY": {
      const readyCycles = (persisted.readyCycles ?? 0) + 1;
      next.readyCycles = readyCycles;

      // Check for hard invalidation first (before entry trigger)
      const invalidReason = checkReadyInvalidation(
        persisted,
        ctx,
        currentPrice,
        tfConstants,
      );
      if (invalidReason) {
        next = {
          ...next,
          state: "INVALIDATED",
          previousState: "READY",
          createdAt: now,
          invalidationReason: invalidReason,
          invalidatedAt: now,
          invalidatedFadeMs: 0,
        };
        break;
      }

      // Check if a fresh setup requires a new setupId (structure changed materially)
      const setup = extractValidSetup(ctx);
      if (setup && persisted.entryZone && persisted.slZone) {
        const materialChange =
          setup.direction !== persisted.direction ||
          zonesChangedMaterially(
            setup.entryZone,
            persisted.entryZone,
            currentPrice,
          ) ||
          zonesChangedMaterially(setup.slZone, persisted.slZone, currentPrice);

        if (materialChange) {
          // Material structure change — new setupId, restart from BUILDING
          next = {
            ...createNoSetupState(),
            state: "BUILDING",
            previousState: "READY",
            createdAt: now,
            buildingCycles: 1,
            direction: setup.direction,
            entryZone: setup.entryZone,
            slZone: setup.slZone,
            tp1Zone: setup.tp1Zone,
            tp2Zone: setup.tp2Zone,
            rewardRisk: setup.rr,
            source: "LIVE",
            stateAgeMs: 0,
            updatedAt: now,
          };
          break;
        }
      }

      // Check for entry trigger — price enters entry zone
      if (
        persisted.entryZone &&
        priceInZone(currentPrice, persisted.entryZone)
      ) {
        next = {
          ...next,
          state: "ACTIVE",
          previousState: "READY",
          createdAt: now,
          triggerPrice: currentPrice,
        };
        break;
      }

      // Soft downgrade — only after minimum persistence AND if conditions truly gone
      if (
        !setup &&
        readyCycles >= tfConstants.MIN_READY_CYCLES &&
        now - persisted.createdAt >= tfConstants.MIN_READY_MS
      ) {
        if (!isConditionsBuilding(ctx)) {
          next = {
            ...next,
            state: "BUILDING",
            previousState: "READY",
            createdAt: now,
            buildingCycles: 1,
          };
        }
      }
      break;
    }

    // ── ACTIVE ────────────────────────────────────────────────────────────────
    case "ACTIVE": {
      // Once ACTIVE, never go back to READY or BUILDING

      // Check hard invalidation (SL hit)
      const invalidReason = checkHardInvalidation(
        persisted,
        ctx,
        currentPrice,
        tfConstants,
      );
      if (invalidReason) {
        next = {
          ...next,
          state: "INVALIDATED",
          previousState: "ACTIVE",
          createdAt: now,
          invalidationReason: invalidReason,
          invalidatedAt: now,
          invalidatedFadeMs: 0,
        };
        break;
      }

      // Check TP1 hit
      if (persisted.tp1Zone && persisted.direction) {
        const tp1Hit =
          persisted.direction === "LONG"
            ? currentPrice >= persisted.tp1Zone.start
            : currentPrice <= persisted.tp1Zone.end;
        if (tp1Hit) {
          next = {
            ...next,
            state: "TP1_HIT",
            previousState: "ACTIVE",
            createdAt: now,
            tp1HitAt: now,
          };
        }
      }
      break;
    }

    // ── TP1_HIT ───────────────────────────────────────────────────────────────
    case "TP1_HIT": {
      // Check hard invalidation (SL hit after TP1)
      const invalidReason = checkHardInvalidation(
        persisted,
        ctx,
        currentPrice,
        tfConstants,
      );
      if (invalidReason) {
        next = {
          ...next,
          state: "INVALIDATED",
          previousState: "TP1_HIT",
          createdAt: now,
          invalidationReason: invalidReason,
          invalidatedAt: now,
          invalidatedFadeMs: 0,
        };
        break;
      }

      // Check TP2 hit
      if (persisted.tp2Zone && persisted.direction) {
        const tp2Hit =
          persisted.direction === "LONG"
            ? currentPrice >= persisted.tp2Zone.start
            : currentPrice <= persisted.tp2Zone.end;
        if (tp2Hit) {
          next = {
            ...next,
            state: "TP2_HIT",
            previousState: "TP1_HIT",
            createdAt: now,
            tp2HitAt: now,
          };
        }
      }
      break;
    }

    // ── TP2_HIT ───────────────────────────────────────────────────────────────
    case "TP2_HIT": {
      // Terminal state — stays until TTL expires or user resets
      // After a settling period, reset to NO_SETUP for fresh setups
      if (stateAgeMs > tfConstants.MACHINE_STATE_TTL_MS * 2) {
        next = { ...createNoSetupState(), source: "LIVE" };
      }
      break;
    }

    // ── INVALIDATED ───────────────────────────────────────────────────────────
    case "INVALIDATED": {
      const fadeMs = now - (persisted.invalidatedAt ?? now);
      next.invalidatedFadeMs = fadeMs;

      // After fade window, allow recycling to BUILDING if new conditions form
      if (fadeMs >= tfConstants.INVALIDATED_FADE_MS) {
        if (isConditionsBuilding(ctx)) {
          next = {
            ...createNoSetupState(),
            state: "BUILDING",
            previousState: "INVALIDATED",
            createdAt: now,
            buildingCycles: 1,
            direction:
              ctx.entryBias !== "NEUTRAL"
                ? (ctx.entryBias as "LONG" | "SHORT")
                : null,
            entryZone: ctx.entryZone,
            slZone: ctx.slZone,
            tp1Zone: ctx.tp1Zone,
            tp2Zone: ctx.tp2Zone ?? null,
            rewardRisk: ctx.rMultiple ?? 0,
            source: "LIVE",
            stateAgeMs: 0,
            updatedAt: now,
          };
        } else {
          // Conditions not forming — go to NO_SETUP
          next = { ...createNoSetupState(), source: "LIVE" };
        }
      }
      break;
    }
  }

  // ── Persist and return ────────────────────────────────────────────────────
  const finalState: PersistentExecutionState = {
    ...next,
    version: (persisted.version ?? 0) + 1,
    stateAgeMs: now - (next.createdAt ?? now),
    source: "LIVE",
  };

  lastKnownGoodExecutionMap.set(cacheKey, { state: finalState, ts: now });
  saveToStorage(cacheKey, finalState);

  return finalState;
}

/**
 * Load the persisted state for a symbol+timeframe (e.g. on monitor open).
 * Returns null if no valid state exists.
 */
export function loadPersistedMachineState(
  symbol: string,
  timeframe: string,
): PersistentExecutionState | null {
  const cacheKey = `${symbol}_${timeframe}`;
  const inMemory = lastKnownGoodExecutionMap.get(cacheKey);
  if (inMemory && Date.now() - inMemory.ts < 45_000) {
    return inMemory.state;
  }
  return loadFromStorage(cacheKey);
}

/**
 * Clear state for a symbol+timeframe (e.g. on symbol change).
 */
export function clearMachineState(symbol: string, timeframe: string): void {
  const cacheKey = `${symbol}_${timeframe}`;
  lastKnownGoodExecutionMap.delete(cacheKey);
  try {
    localStorage.removeItem(STORAGE_KEY_PREFIX + cacheKey);
  } catch {
    // ignore
  }
}

/** Human-readable label for each state */
export function getMachineStateLabel(state: ExecutionMachineState): string {
  const labels: Record<ExecutionMachineState, string> = {
    NO_SETUP: "NO SETUP",
    BUILDING: "BUILDING",
    READY: "READY",
    ACTIVE: "ACTIVE",
    INVALIDATED: "INVALIDATED",
    TP1_HIT: "TP1 HIT",
    TP2_HIT: "TP2 HIT",
  };
  return labels[state];
}
