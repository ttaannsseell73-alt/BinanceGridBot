import { describe, expect, it } from 'vitest';
import { EmergencyRiskEngine } from '../../engine/EmergencyRiskEngine';

function makeEngine() {
  return new EmergencyRiskEngine({
    maxAdverseMovePct: 0.03,
    minLiquidationDistancePct: 0.05,
    maxConsecutiveCriticalErrors: 10
  });
}

describe('EmergencyRiskEngine', () => {
  it('triggers after a 3% adverse move for a long position', () => {
    const engine = makeEngine();
    engine.setReferencePrice(100);
    expect(engine.evaluateAdverseMove(97.1, 1)).toBeNull();
    expect(engine.evaluateAdverseMove(97, 1)).toBe('ADVERSE_PRICE_MOVE');
  });

  it('triggers after a 3% adverse move for a short position', () => {
    const engine = makeEngine();
    engine.setReferencePrice(100);
    expect(engine.evaluateAdverseMove(102.9, -1)).toBeNull();
    expect(engine.evaluateAdverseMove(103, -1)).toBe('ADVERSE_PRICE_MOVE');
  });

  it('triggers when liquidation distance is 5% or less', () => {
    const engine = makeEngine();
    expect(engine.evaluateLiquidationDistance({
      symbol: 'BTCUSDT',
      positionAmt: 0.1,
      entryPrice: 100,
      markPrice: 100,
      liquidationPrice: 95
    })).toBe('LIQUIDATION_DISTANCE_CRITICAL');

    expect(engine.evaluateLiquidationDistance({
      symbol: 'BTCUSDT',
      positionAmt: 0.1,
      entryPrice: 100,
      markPrice: 100,
      liquidationPrice: 94.9
    })).toBeNull();
  });

  it('does not evaluate liquidation distance for a flat position', () => {
    const engine = makeEngine();
    expect(engine.evaluateLiquidationDistance({
      symbol: 'BTCUSDT',
      positionAmt: 0,
      entryPrice: 0,
      markPrice: 100,
      liquidationPrice: 0
    })).toBeNull();
  });

  it('triggers on ten consecutive critical failures and resets on success', () => {
    const engine = makeEngine();

    for (let i = 0; i < 9; i++) {
      expect(engine.recordCriticalFailure()).toBeNull();
    }

    engine.recordCriticalSuccess();
    expect(engine.getConsecutiveCriticalErrors()).toBe(0);

    for (let i = 0; i < 9; i++) {
      expect(engine.recordCriticalFailure()).toBeNull();
    }

    expect(engine.recordCriticalFailure()).toBe('CONSECUTIVE_CRITICAL_ERRORS');
    expect(engine.getConsecutiveCriticalErrors()).toBe(10);
  });
});
