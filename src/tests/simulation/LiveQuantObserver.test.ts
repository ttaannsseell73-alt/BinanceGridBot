import { describe, expect, it, vi } from 'vitest';
import { Candle, MicrostructureFeatures, PriceActionFeatures } from '../../models/strategy';
import { LiveQuantObserver } from '../../simulation/LiveQuantObserver';
import { QuantEngine } from '../../strategy/QuantEngine';

const pa: PriceActionFeatures = {
  swingHighs: [],
  swingLows: [],
  marketStructure: 'LH',
  inRange: true,
  rangeHigh: 102,
  rangeLow: 98,
  breakoutUp: false,
  breakoutDown: false,
  liquiditySweepUp: false,
  liquiditySweepDown: false
};

const ms: MicrostructureFeatures = {
  cvd: 12,
  takerImbalance: 1.2,
  oiDelta: 0.001,
  absorption: false
};

function candle(timestamp: number, close: number): Candle {
  return {
    timestamp,
    open: close,
    high: close + 2,
    low: close - 2,
    close,
    volume: 100,
    isClosed: true
  };
}

describe('LiveQuantObserver', () => {
  it('records an exact live-feature observation after the fixed horizon', () => {
    const quant = new QuantEngine({
      feeRate: 0.0004,
      syntheticSlippage: 0.0001,
      minSamples: 1
    });
    const onObservation = vi.fn();
    const observer = new LiveQuantObserver({
      gridLevels: 1,
      gridSpacing: 1,
      baseOrderQty: 0.1,
      horizonCandles: 2,
      strideCandles: 1,
      makerFeeRate: 0.0002,
      syntheticSlippageRate: 0.0001
    }, quant, onObservation);

    expect(observer.processClosedCandle(candle(60_000, 100), pa, ms)).toBe(0);
    expect(observer.processClosedCandle(candle(120_000, 100), pa, ms)).toBe(0);
    expect(observer.processClosedCandle(candle(180_000, 100), pa, ms)).toBe(1);

    const score = quant.evaluate(pa, ms);
    expect(score.modelSource).toBe('EXACT');
    expect(score.sampleCount).toBeGreaterThanOrEqual(1);
    expect(onObservation).toHaveBeenCalledTimes(1);
    expect(observer.getStats().totalRecorded).toBe(1);
  });

  it('ignores duplicate or out-of-order closed candles', () => {
    const quant = new QuantEngine({
      feeRate: 0.0004,
      syntheticSlippage: 0.0001,
      minSamples: 1
    });
    const observer = new LiveQuantObserver({
      gridLevels: 1,
      gridSpacing: 1,
      baseOrderQty: 0.1,
      horizonCandles: 2,
      strideCandles: 1,
      makerFeeRate: 0.0002,
      syntheticSlippageRate: 0.0001
    }, quant);

    observer.processClosedCandle(candle(60_000, 100), pa, ms);
    observer.processClosedCandle(candle(60_000, 100), pa, ms);
    observer.processClosedCandle(candle(30_000, 100), pa, ms);

    expect(observer.getStats().processedClosedCandles).toBe(1);
    expect(observer.getStats().pendingEpisodes).toBe(1);
  });

  it('does not start an episode until PA and all microstructure fields are usable', () => {
    const quant = new QuantEngine({
      feeRate: 0.0004,
      syntheticSlippage: 0.0001,
      minSamples: 1
    });
    const observer = new LiveQuantObserver({
      gridLevels: 1,
      gridSpacing: 1,
      baseOrderQty: 0.1,
      horizonCandles: 2,
      strideCandles: 1,
      makerFeeRate: 0.0002,
      syntheticSlippageRate: 0.0001
    }, quant);

    observer.processClosedCandle(
      candle(60_000, 100),
      pa,
      { ...ms, oiDelta: 'UNAVAILABLE_DUE_TO_DATA' }
    );

    observer.processClosedCandle(
      candle(120_000, 100),
      { ...pa, marketStructure: 'NONE' },
      ms
    );

    expect(observer.getStats().pendingEpisodes).toBe(0);
  });
});
