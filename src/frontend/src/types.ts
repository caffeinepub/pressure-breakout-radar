import type { PersistentExecutionState } from "./executionStateMachine";
export type Phase = "FLAT" | "BUILDING" | "PRE-BURST" | "ACTIVE" | "BREAKOUT";
export type PressureSide = "UP" | "DOWN" | "NEUTRAL";
export type VacuumSide = "ABOVE" | "BELOW" | "NONE";
export type AppStatus = "LIVE" | "SCANNING" | "ERROR" | "STALE" | "USING_CACHE";

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PressureResult {
  side: PressureSide;
  strength: number;
}

export interface Candidate {
  symbol: string;
  rank: number;
  price: number;
  priceChangePercent: number;
  tension: number;
  pressure: PressureResult;
  breakoutScore: number;
  phase: Phase;
  vacuumSide: VacuumSide;
}

export interface LivePatch {
  price?: number;
  priceChangePercent?: number;
  tension?: number;
  pressure?: PressureResult;
  breakoutScore?: number;
  phase?: Phase;
  vacuumSide?: VacuumSide;
  lastUpdateTime?: number;
  isStale?: boolean;
}

export type MonitorStatus = "LIVE" | "STALE" | "REFRESHING" | "ERROR";
export type TrendDirection = "RISING" | "FALLING" | "FLAT";
export type BreakoutBias = "UP" | "DOWN" | "NEUTRAL";

export interface BreakoutContext {
  upperStructure: number;
  lowerStructure: number;
  distanceToUpper: number;
  distanceToLower: number;
  bias: BreakoutBias;
}

export interface AggressionBubble {
  candleOpenTime: number;
  price: number;
  side: "BUY" | "SELL";
  strength: number;
  radius: number;
}

export interface VacuumZone {
  side: VacuumSide;
  startPrice: number;
  endPrice: number;
}

export interface BubbleDebugStats {
  eventsDetected: number;
  greenBubbles: number;
  redBubbles: number;
  avgRadius: number;
  maxStrength: number;
  dirThreshold: number;
  volFloor: number;
}

/** Full diagnostics for the agg-trade fetch subsystem — shown in debug panel */
export interface BubbleFetchDiagnostics {
  /** Specific failure classification */
  failureType?:
    | "ABORT_ERROR"
    | "NETWORK_ERROR"
    | "HTTP_ERROR"
    | "PARSE_ERROR"
    | "EMPTY_RESPONSE";
  /** Error constructor name (e.g. "TypeError", "AbortError") */
  errorName?: string;
  /** Human-readable error message */
  errorMessage?: string;
  /** HTTP response status code — only present for HTTP_ERROR */
  httpStatus?: number;
  /** The full request URL that was attempted */
  requestUrl?: string;
  /** Symbol passed to the agg-trade fetch */
  symbol: string;
  /** Timeframe active at time of fetch */
  timeframe: string;
  /** Timestamp (ms) of the last successful agg-trade fetch that produced bubbles */
  lastSuccessTs: number;
  /** Number of visible bubbles from the last successful fetch */
  lastSuccessBubbleCount: number;
}

export type RangePosition = "LOWER" | "MID" | "UPPER";
export type ExecutionQuality = "HIGH" | "MEDIUM" | "LOW";
export type EntryBias = "LONG" | "SHORT" | "NEUTRAL";

export interface ExecutionZone {
  start: number;
  end: number;
}

export interface ExecutionContext {
  rangePosition: RangePosition;
  rangeValue: number;
  entryBias: EntryBias;
  executionQuality: ExecutionQuality;
  entryZone: ExecutionZone | null;
  slZone: ExecutionZone | null;
  tp1Zone: ExecutionZone | null;
  tp2Zone: ExecutionZone | null;
  interpretationLine: string;
  alignmentScore: number;
  hasCleanEntry: boolean;
  structurallyLimited?: boolean;
  rMultiple?: number;
  // Execution validity — set when directional math is inconsistent
  executionInvalid?: boolean;
  invalidReason?: string;
  // Directional alignment — independent of execution validity
  // "FULL_LONG" | "FULL_SHORT" | "CONFLICT" | "NO_CLEAR" | "LONG_LEAN" | "SHORT_LEAN"
  directionalState: string;
  // Execution validity — separate layer
  // "VALID_LONG" | "VALID_SHORT"
  // "LONG_BIAS_NO_EXEC" | "SHORT_BIAS_NO_EXEC" — invalid reward math
  // "LONG_BIAS_NO_CLEAN_ENTRY" | "SHORT_BIAS_NO_CLEAN_ENTRY" — price too far from aggression cluster
  // "LONG_NO_AGGRESSION_CLUSTER" | "SHORT_NO_AGGRESSION_CLUSTER" — no cluster found
  // "NEUTRAL_LOW"
  // "RECLAIM_LONG" | "RECLAIM_SHORT" — valid reclaim entry from failed aggression
  // "RECLAIM_LONG_WAIT_RETEST" | "RECLAIM_SHORT_WAIT_RETEST" — price extended, wait for retest
  executionValidityState: string;
  // No-chase: price too far from the aggression cluster
  isNoChase?: boolean;
  // Overhead vacuum short — vacuum above price acting as overhead resistance
  isOverheadVacuumShort?: boolean;
  // Whether no meaningful aggression cluster was found
  noAggressionCluster?: boolean;
  // Whether this is a reclaim entry (failed aggression model)
  isReclaimEntry?: boolean;
  // Which type of reclaim: LONG (reclaimed above failed red) or SHORT (broke below failed green)
  reclaimType?: "LONG_RECLAIM" | "SHORT_RECLAIM" | null;
  // Ideal short entry zone for faint chart reference in no-chase state
  idealShortEntryZone?: ExecutionZone | null;
  // Ideal long entry zone for faint chart reference in no-chase state
  idealLongEntryZone?: ExecutionZone | null;
  // Vacuum invalidation zone for faint chart reference
  vacuumInvalidationZone?: ExecutionZone | null;
}

export interface SelectedMonitorSnapshot {
  symbol: string;
  price: number;
  phase: Phase;
  tension: number;
  tensionTrend: TrendDirection;
  pressure: PressureResult;
  pressureTrend: TrendDirection;
  breakoutScore: number;
  breakoutContext: BreakoutContext | null;
  candles: Kline[];
  status: MonitorStatus;
  lastSuccessTime: number;
  aggressionBubbles?: AggressionBubble[];
  bubbleDebug?: BubbleDebugStats;
  bubbleLoopStatus?:
    | "BOOTSTRAPPING"
    | "FETCHING"
    | "WS_CONNECTING"
    | "WS_LIVE"
    | "WS_RECONNECTING"
    | "LIVE"
    | "NO_EVENTS"
    | "RETRYING"
    | "STALE";
  bubbleRetryCount?: number;
  bubbleLastFetchCause?: string;
  /** Full fetch diagnostics — populated whenever a fetch fails or on every tick for transparency */
  bubbleFetchDiagnostics?: BubbleFetchDiagnostics;
  timeframe?: "1m" | "5m" | "15m";
  vacuumZone?: VacuumZone;
  executionContext?: ExecutionContext;
  executionMachineState?: PersistentExecutionState;
}

// Re-exported types from executionStateMachine for convenience
export type {
  ExecutionMachineState,
  InvalidationReason,
  PersistentExecutionState,
} from "./executionStateMachine";
