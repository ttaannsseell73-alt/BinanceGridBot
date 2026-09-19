import { describe, expect, it } from 'vitest';
import { Candle } from '../../models/strategy';
import { simulateVirtualGridOutcome } from '../../simulation/QuantTrainer';

function candle(high: number, low: number, close: number, timestamp: number): Candle {
  return {
    timestamp,
    open: close,
    high,
    low,
    close,
    volume: 1,
    isClosed: true
  };
}

const cfg = {
  gridLevels: 1,
  gridSpacing: 100,
  baseOrderQty: 1,
  makerFeeRate: 0,
  syntheticSlippageRate: 0
};

describe('simulateVirtualGridOutcome', () => {
  it('captures positive range PnL when both symmetric levels fill and price ends at anchor', () => {
    const outcome = simulateVirtualGridOutcome(
      10_000,
      [candle(10_150, 9_850, 10_000, 1)],
      cfg
    );

    expect(outcome.filledOrders).toBe(2);
    expect(outcome.terminalPosition).toBeCloseTo(0);
    expect(outcome.grossPnl).toBeCloseTo(200);
    expect(outcome.netReturn).toBeCloseTo(0.02);
  });

  it('marks one-sided inventory to market at the bounded horizon', () => {
    const outcome = simulateVirtualGridOutcome(
      10_000,
      [candle(10_020, 9_850, 9_800, 1)],
      cfg
    );

    expect(outcome.filledOrders).toBe(1);
    expect(outcome.terminalPosition).toBeCloseTo(1);
    // Buy 9,900 then mark at 9,800 -> -100.
    expect(outcome.grossPnl).toBeCloseTo(-100);
    expect(outcome.netReturn).toBeCloseTo(-0.01);
  });

  it('includes modeled entry and terminal exit costs', () => {
    const outcome = simulateVirtualGridOutcome(
      10_000,
      [candle(10_020, 9_850, 10_000, 1)],
      {
        ...cfg,
        makerFeeRate: 0.0002,
        syntheticSlippageRate: 0.0001
      }
    );

    expect(outcome.filledOrders).toBe(1);
    expect(outcome.netPnl).toBeLessThan(outcome.grossPnl);
  });
});
