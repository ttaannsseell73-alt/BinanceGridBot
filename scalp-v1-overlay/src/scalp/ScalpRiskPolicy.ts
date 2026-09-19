import { PositionSizingRequest, PositionSizingResult } from './types';

export interface ScalpRiskConfig {
  capitalUsd: number;
  riskPerTradeUsd: number;
  maxOpenRiskUsd: number;
  dailyMaxLossUsd: number;
  defaultLeverage: number;
  maxLeverage: number;
  maxMarginPerTradePct: number;
  minStopDistancePct: number;
}

const DEFAULT_CONFIG: ScalpRiskConfig = {
  capitalUsd: 1_000,
  riskPerTradeUsd: 5,
  maxOpenRiskUsd: 15,
  dailyMaxLossUsd: 25,
  defaultLeverage: 3,
  maxLeverage: 5,
  maxMarginPerTradePct: 0.50,
  minStopDistancePct: 0.05,
};

export class ScalpRiskPolicy {
  private readonly config: ScalpRiskConfig;
  constructor(config: Partial<ScalpRiskConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public size(req: PositionSizingRequest): PositionSizingResult {
    const leverage = Math.min(Math.max(1, req.leverage ?? this.config.defaultLeverage), this.config.maxLeverage);
    const fail = (reason: string): PositionSizingResult => ({
      allowed: false, reason, leverage, riskUsd: 0, stopDistancePct: 0, notionalUsd: 0, marginUsd: 0, quantity: 0,
    });

    if (req.realizedPnlTodayUsd <= -this.config.dailyMaxLossUsd) return fail('DAILY_LOSS_LIMIT');
    if (req.currentOpenRiskUsd + this.config.riskPerTradeUsd > this.config.maxOpenRiskUsd) return fail('MAX_OPEN_RISK');
    if (!(req.entryPrice > 0) || !(req.stopPrice > 0) || req.entryPrice === req.stopPrice) return fail('INVALID_ENTRY_STOP');

    const stopDistancePct = Math.abs(req.entryPrice - req.stopPrice) / req.entryPrice * 100;
    if (stopDistancePct < this.config.minStopDistancePct) return fail('STOP_TOO_TIGHT');

    const stopFraction = stopDistancePct / 100;
    const riskBasedNotional = this.config.riskPerTradeUsd / stopFraction;
    const maxMargin = this.config.capitalUsd * this.config.maxMarginPerTradePct;
    const maxNotionalByMargin = maxMargin * leverage;
    const notionalUsd = Math.min(riskBasedNotional, maxNotionalByMargin);
    const marginUsd = notionalUsd / leverage;
    const quantity = notionalUsd / req.entryPrice;
    const riskUsd = notionalUsd * stopFraction;

    return { allowed: true, leverage, riskUsd, stopDistancePct, notionalUsd, marginUsd, quantity };
  }
}
