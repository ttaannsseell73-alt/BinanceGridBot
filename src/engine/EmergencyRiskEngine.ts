import { PositionRiskSnapshot } from '../gateways/IBinanceClient';

export type EmergencyReason =
  | 'ADVERSE_PRICE_MOVE'
  | 'LIQUIDATION_DISTANCE_CRITICAL'
  | 'CONSECUTIVE_CRITICAL_ERRORS';

export interface EmergencyRiskConfig {
  maxAdverseMovePct: number;
  minLiquidationDistancePct: number;
  maxConsecutiveCriticalErrors: number;
}

export class EmergencyRiskEngine {
  private referencePrice: number | null = null;
  private consecutiveCriticalErrors = 0;

  constructor(private readonly config: EmergencyRiskConfig) {
    if (
      config.maxAdverseMovePct <= 0 ||
      config.minLiquidationDistancePct <= 0 ||
      config.maxConsecutiveCriticalErrors < 1
    ) {
      throw new Error('Invalid emergency risk configuration');
    }
  }

  public setReferencePrice(price: number): void {
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error('Emergency risk reference price must be positive');
    }
    this.referencePrice = price;
  }

  public getReferencePrice(): number | null {
    return this.referencePrice;
  }

  public evaluateAdverseMove(
    currentPrice: number,
    positionAmount: number
  ): EmergencyReason | null {
    if (
      this.referencePrice === null ||
      !Number.isFinite(currentPrice) ||
      currentPrice <= 0 ||
      !Number.isFinite(positionAmount) ||
      Math.abs(positionAmount) < 1e-12
    ) {
      return null;
    }

    if (
      positionAmount > 0 &&
      currentPrice <= this.referencePrice * (1 - this.config.maxAdverseMovePct)
    ) {
      return 'ADVERSE_PRICE_MOVE';
    }

    if (
      positionAmount < 0 &&
      currentPrice >= this.referencePrice * (1 + this.config.maxAdverseMovePct)
    ) {
      return 'ADVERSE_PRICE_MOVE';
    }

    return null;
  }

  public evaluateLiquidationDistance(
    snapshot: PositionRiskSnapshot
  ): EmergencyReason | null {
    if (Math.abs(snapshot.positionAmt) < 1e-12) return null;

    if (
      !Number.isFinite(snapshot.markPrice) ||
      snapshot.markPrice <= 0 ||
      !Number.isFinite(snapshot.liquidationPrice) ||
      snapshot.liquidationPrice <= 0
    ) {
      return null;
    }

    const distance =
      Math.abs(snapshot.markPrice - snapshot.liquidationPrice) /
      snapshot.markPrice;

    return distance <= this.config.minLiquidationDistancePct
      ? 'LIQUIDATION_DISTANCE_CRITICAL'
      : null;
  }

  public recordCriticalSuccess(): void {
    this.consecutiveCriticalErrors = 0;
  }

  public recordCriticalFailure(): EmergencyReason | null {
    this.consecutiveCriticalErrors += 1;
    return this.consecutiveCriticalErrors >=
      this.config.maxConsecutiveCriticalErrors
      ? 'CONSECUTIVE_CRITICAL_ERRORS'
      : null;
  }

  public getConsecutiveCriticalErrors(): number {
    return this.consecutiveCriticalErrors;
  }
}
