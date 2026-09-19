import { describe, it, expect } from 'vitest';
import { StrategyEngine } from '../../strategy/StrategyEngine';
import { QuantScore } from '../../models/strategy';

describe('StrategyEngine', () => {
  const config = {
    symbol: 'BTCUSDT',
    gridLevels: 3,
    gridSpacing: 100,
    baseOrderQty: 0.1,
    skewFactor: 0.5,
    minExpectancy: 0.001,
    minSamples: 30,
    safetyMultiplier: 1.5,
    expectedCostBps: 0.002
  };

  it('should not generate a grid if sample count is too low', () => {
    const engine = new StrategyEngine(config);
    const score: QuantScore = { sampleCount: 10, hitRate: 0.6, expectancy: 0.05, averageWin: 0.1, averageLoss: -0.05, mae: -0.1, mfe: 0.2 };
    
    const intents = engine.generateGrid(50000, null, 0, score);
    expect(intents.length).toBe(0);
  });

  it('should not generate a grid if expectancy is too low', () => {
    const engine = new StrategyEngine(config);
    const score: QuantScore = { sampleCount: 50, hitRate: 0.4, expectancy: -0.01, averageWin: 0.05, averageLoss: -0.05, mae: -0.1, mfe: 0.1 };
    
    const intents = engine.generateGrid(50000, null, 0, score);
    expect(intents.length).toBe(0);
  });

  it('should generate a grid if quant score meets thresholds', () => {
    const engine = new StrategyEngine(config);
    const score: QuantScore = { sampleCount: 50, hitRate: 0.6, expectancy: 0.05, averageWin: 0.1, averageLoss: -0.05, mae: -0.1, mfe: 0.2 };
    
    const intents = engine.generateGrid(50000, null, 0, score);
    // 3 buy + 3 sell
    expect(intents.length).toBe(6);
    
    // Check buy orders
    const buys = intents.filter(i => i.side === 'BUY');
    expect(buys.length).toBe(3);
    expect(buys[0].price).toBe(49900);
    expect(buys[1].price).toBe(49800);
    expect(buys[2].price).toBe(49700);

    // Check sell orders
    const sells = intents.filter(i => i.side === 'SELL');
    expect(sells.length).toBe(3);
    expect(sells[0].price).toBe(50100);
    expect(sells[1].price).toBe(50200);
    expect(sells[2].price).toBe(50300);
  });
});
