import { describe, it, expect } from 'vitest';
import { PriceActionEngine } from '../../strategy/PriceActionEngine';
import { Candle } from '../../models/strategy';

describe('PriceActionEngine', () => {
  const createCandle = (high: number, low: number, close: number, ts: number): Candle => ({
    timestamp: ts,
    open: close,
    high,
    low,
    close,
    volume: 100,
    isClosed: true,
  });

  it('should detect swing highs and lows with pivot length 2', () => {
    const engine = new PriceActionEngine(2);
    
    // Create a peak at index 2 (val 150)
    // Indexes: 0, 1, 2, 3, 4
    const candles = [
      createCandle(100, 90, 95, 1000),
      createCandle(120, 110, 115, 2000),
      createCandle(150, 130, 140, 3000), // Pivot High
      createCandle(130, 120, 125, 4000),
      createCandle(110, 100, 105, 5000), // Push to process
    ];

    let lastFeatures;
    for (const c of candles) {
      lastFeatures = engine.processCandle(c);
    }

    expect(lastFeatures?.swingHighs.length).toBe(1);
    expect(lastFeatures?.swingHighs[0].price).toBe(150);
  });

  it('should detect range and breakouts', () => {
    const engine = new PriceActionEngine(1); // fast pivot for testing
    
    // Build a range
    const candles = [
      createCandle(100, 90, 95, 1000),
      createCandle(150, 110, 115, 2000), // High 1
      createCandle(100, 80, 85, 3000),   // Low 1
      createCandle(149, 110, 115, 4000), // High 2
      createCandle(100, 80, 85, 5000),   // Low 2
      createCandle(120, 100, 110, 6000), // Consolidate to form the pivots
    ];

    let lastFeatures;
    for (const c of candles) {
      lastFeatures = engine.processCandle(c);
    }

    // Should be in range since High 1 (150) and High 2 (149) are within 0.2%, Low 1 (80) and Low 2 (79) are close
    expect(lastFeatures?.inRange).toBe(true);
    
    // Now trigger a breakout up
    const breakoutCandle = createCandle(160, 150, 155, 7000);
    lastFeatures = engine.processCandle(breakoutCandle);
    expect(lastFeatures?.breakoutUp).toBe(true);
    expect(lastFeatures?.liquiditySweepUp).toBe(false); // because it closed outside

    // Now trigger a liquidity sweep down
    const sweepCandle = createCandle(100, 70, 90, 8000); // Low is 70 (below range), but close is 90 (above range low)
    lastFeatures = engine.processCandle(sweepCandle);
    expect(lastFeatures?.liquiditySweepDown).toBe(true);
    expect(lastFeatures?.breakoutDown).toBe(false); // didn't close below
  });

  it('should detect market structure', () => {
    const engine = new PriceActionEngine(1);
    const candles = [
      // Trend up
      createCandle(100, 90, 95, 1000),
      createCandle(120, 110, 115, 2000), // High 1
      createCandle(100, 80, 85, 3000),   // Low 1
      createCandle(140, 120, 125, 4000), // High 2
      createCandle(120, 100, 105, 5000), // Low 2
      createCandle(130, 110, 120, 6000), // Finalize pivot
    ];

    let lastFeatures;
    for (const c of candles) {
      lastFeatures = engine.processCandle(c);
    }

    // High 2 > High 1, Low 2 > Low 1 -> Higher Highs (HH)
    expect(lastFeatures?.marketStructure).toBe('HH');
  });
});
