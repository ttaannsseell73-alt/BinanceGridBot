import { describe, it, expect } from 'vitest';
import { HistoricalSimulator } from '../../simulation/HistoricalSimulator';
import { StrategyConfig } from '../../strategy/StrategyEngine';
import { Candle } from '../../models/strategy';

describe('HistoricalSimulator', () => {
  const config: StrategyConfig = {
    symbol: 'BTCUSDT',
    gridLevels: 3,
    gridSpacing: 100,
    baseOrderQty: 0.1,
    skewFactor: 0.5,
    minExpectancy: -1, // force grid to always place
    minSamples: 0,
    safetyMultiplier: 1.0,
    expectedCostBps: 0.0018
  };

  it('should run simulation without errors and generate report', async () => {
    const simulator = new HistoricalSimulator(config, 10000);
    
    const klines: Candle[] = [
      { timestamp: 1000, open: 50000, high: 50100, low: 49900, close: 50000, volume: 100, takerBuyBaseAssetVolume: 50, isClosed: true },
      { timestamp: 2000, open: 50000, high: 50200, low: 49800, close: 50100, volume: 150, takerBuyBaseAssetVolume: 75, isClosed: true }, // Should fill some grid levels
      { timestamp: 3000, open: 50100, high: 50300, low: 49700, close: 49800, volume: 200, takerBuyBaseAssetVolume: 100, isClosed: true }
    ];

    const report = await simulator.run(klines);
    
    // We expect some trades to have occurred
    expect(report.tradeCount).toBeGreaterThan(0);
    
    // We expect fees and slippage to be tracked
    expect(report.totalFees).toBeGreaterThan(0);
    expect(report.totalSlippage).toBeGreaterThan(0);

    // Initial capital is 10000, so some small pnl changes should be reflected
    expect(report.netPnl).not.toBe(0);
  });
});


