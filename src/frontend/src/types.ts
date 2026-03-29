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
  timeframe?: "1m" | "5m" | "15m";
  vacuumZone?: VacuumZone;
  executionContext?: ExecutionContext;
}
