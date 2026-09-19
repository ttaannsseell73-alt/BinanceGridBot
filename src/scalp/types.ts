export type ScalpDirection = 'LONG' | 'SHORT';
export type DecisionAction = ScalpDirection | 'PASS';

export interface TradeTick {
  symbol: string;
  timestamp: number;
  price: number;
  quantity: number;
  /** Binance aggTrade semantics: true => buyer is maker => aggressive seller. */
  isBuyerMaker: boolean;
}

export interface Candle {
  symbol: string;
  interval: '1m' | '5m';
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
}

export interface BookSnapshot {
  symbol: string;
  timestamp: number;
  bid: number;
  ask: number;
}

export interface RadarCandidate {
  symbol: string;
  direction: ScalpDirection;
  timestamp: number;
  heatScore: number;
  priceImpulsePct: number;
  quoteVolume: number;
  tradeRatePerSec: number;
  volumeImpulse: number;
  tradeRateImpulse: number;
  takerBuyRatio: number;
}

export interface TrendLine {
  kind: 'DESCENDING_RESISTANCE' | 'ASCENDING_SUPPORT';
  baseTimestamp: number;
  intercept: number;
  slopePerMs: number;
  r2: number;
  pivots: number;
}

export interface BreakoutSignal {
  symbol: string;
  direction: ScalpDirection;
  timestamp: number;
  breakoutPrice: number;
  projectedLinePrice: number;
  distanceBps: number;
  volumeRatio: number;
  trendR2: number;
  valid: boolean;
}

export interface OrderFlowSnapshot {
  symbol: string;
  timestamp: number;
  takerBuyRatio: number;
  cvdQuote: number;
  spreadBps: number;
  oiDeltaPct?: number;
  validForLong: boolean;
  validForShort: boolean;
}

export interface ScalpDecision {
  symbol: string;
  timestamp: number;
  action: DecisionAction;
  confidence: number;
  radar?: RadarCandidate;
  breakout?: BreakoutSignal;
  flow?: OrderFlowSnapshot;
  reasons: string[];
}

export interface PositionSizingRequest {
  entryPrice: number;
  stopPrice: number;
  leverage?: number;
  currentOpenRiskUsd: number;
  realizedPnlTodayUsd: number;
}

export interface PositionSizingResult {
  allowed: boolean;
  reason?: string;
  leverage: number;
  riskUsd: number;
  stopDistancePct: number;
  notionalUsd: number;
  marginUsd: number;
  quantity: number;
}

export interface ExitPlan {
  side: ScalpDirection;
  entryPrice: number;
  hardStop: number;
  tp1Price: number;
  tp1Fraction: number;
  tp2Price: number;
  tp2Fraction: number;
  moveStopAfterTp1To: number;
  timeStopMs: number;
  reduceOnly: true;
}
