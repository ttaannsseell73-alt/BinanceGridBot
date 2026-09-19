import { describe, it, expect } from 'vitest';
import { HistoricalSimulator } from '../../simulation/HistoricalSimulator';
import { QuantEngine } from '../../strategy/QuantEngine';
import { StrategyConfig } from '../../strategy/StrategyEngine';
import { Candle } from '../../models/strategy';

describe('Quant IS -> OOS transfer', () => {
  it('trains in IS and remains frozen in OOS', async () => {
    const config: StrategyConfig = {
      symbol: 'BTCUSDT',
      gridLevels: 3,
      gridSpacing: 100,
      baseOrderQty: 0.1,
      skewFactor: 0.5,
      minExpectancy: 0.001,
      minSamples: 1,
      safetyMultiplier: 1.0,
      expectedCostBps: 0.0018
    };

    const quant = new QuantEngine({
      feeRate: 0.0004,
      syntheticSlippage: 0.0001,
      minSamples: 1
    });

    const train: Candle[] = [
      { timestamp: 1000, open: 50000, high: 50020, low: 49980, close: 50000, volume: 100, isClosed: true },
      { timestamp: 2000, open: 50000, high: 50500, low: 49500, close: 50000, volume: 200, isClosed: true },
      { timestamp: 3000, open: 50000, high: 50020, low: 49980, close: 50000, volume: 100, isClosed: true },
      { timestamp: 4000, open: 50000, high: 50500, low: 49500, close: 50000, volume: 200, isClosed: true },
      { timestamp: 5000, open: 50000, high: 50020, low: 49980, close: 50000, volume: 100, isClosed: true },
      { timestamp: 6000, open: 50000, high: 50500, low: 49500, close: 50000, volume: 200, isClosed: true }
    ];

    const isSim = new HistoricalSimulator(config, 10000, 1, 2, quant);
    await isSim.run(train, false);

    const afterIS = quant.getObservationCount();
    expect(afterIS).toBeGreaterThan(0);

    const oosSim = new HistoricalSimulator(config, 10000, 1, 2, quant);
    await oosSim.run(train, true);

    const afterOOS = quant.getObservationCount();

    expect(afterOOS).toBe(afterIS);
  });
});
