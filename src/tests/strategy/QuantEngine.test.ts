import { describe, it, expect } from 'vitest';
import { QuantEngine } from '../../strategy/QuantEngine';
import { PriceActionFeatures, MicrostructureFeatures } from '../../models/strategy';

describe('QuantEngine', () => {
  const defaultPA: PriceActionFeatures = {
    swingHighs: [],
    swingLows: [],
    marketStructure: 'NONE',
    inRange: false,
    rangeHigh: null,
    rangeLow: null,
    breakoutUp: false,
    breakoutDown: false,
    liquiditySweepUp: false,
    liquiditySweepDown: false
  };

  const defaultMS: MicrostructureFeatures = {
    cvd: 0,
    takerImbalance: 1,
    oiDelta: 0,
    absorption: false
  };

  it('should return 0 expectancy for unseen features', () => {
    const engine = new QuantEngine({ feeRate: 0.0004, syntheticSlippage: 0.0001, minSamples: 30 });
    const score = engine.evaluate(defaultPA, defaultMS);

    expect(score.sampleCount).toBe(0);
    expect(score.expectancy).toBe(0);
  });

  it('should calculate legacy raw returns with round-trip costs', () => {
    const engine = new QuantEngine({ feeRate: 0.0004, syntheticSlippage: 0.0001, minSamples: 1 });

    engine.recordObservation(defaultPA, defaultMS, 0.01, 1000);
    engine.recordObservation(defaultPA, defaultMS, 0.02, 1000);
    engine.recordObservation(defaultPA, defaultMS, -0.005, 1000);
    engine.recordObservation(defaultPA, defaultMS, -0.01, 1000);

    const score = engine.evaluate(defaultPA, defaultMS);

    expect(score.sampleCount).toBe(4);
    expect(score.hitRate).toBe(0.5);
    expect(score.averageWin).toBeCloseTo(0.014);
    expect(score.averageLoss).toBeCloseTo(-0.0085);
    expect(score.expectancy).toBeCloseTo(0.00275);
  });

  it('does not double-charge costs for net grid episode observations', () => {
    const engine = new QuantEngine({ feeRate: 0.0004, syntheticSlippage: 0.0001, minSamples: 1 });

    engine.recordNetObservation(defaultPA, defaultMS, 0.002, 60_000);
    engine.recordNetObservation(defaultPA, defaultMS, -0.001, 60_000);

    const score = engine.evaluate(defaultPA, defaultMS);

    expect(score.sampleCount).toBe(2);
    expect(score.hitRate).toBe(0.5);
    expect(score.averageWin).toBeCloseTo(0.002);
    expect(score.averageLoss).toBeCloseTo(-0.001);
    expect(score.expectancy).toBeCloseTo(0.0005);
  });

  it('should differentiate hashes for different features', () => {
    const engine = new QuantEngine({ feeRate: 0, syntheticSlippage: 0, minSamples: 1 });

    const bullishPA = { ...defaultPA, breakoutUp: true };
    engine.recordObservation(bullishPA, defaultMS, 0.05, 1000);

    const scoreBullish = engine.evaluate(bullishPA, defaultMS);
    expect(scoreBullish.sampleCount).toBe(1);

    const scoreDefault = engine.evaluate(defaultPA, defaultMS);
    expect(scoreDefault.sampleCount).toBe(0);
  });
});

describe('QuantEngine model bridge', () => {
  const pa: PriceActionFeatures = {
    swingHighs: [],
    swingLows: [],
    marketStructure: 'LL',
    inRange: false,
    rangeHigh: null,
    rangeLow: null,
    breakoutUp: false,
    breakoutDown: false,
    liquiditySweepUp: false,
    liquiditySweepDown: false
  };

  const historicalMS: MicrostructureFeatures = {
    cvd: 'UNAVAILABLE_DUE_TO_DATA',
    takerImbalance: 'UNAVAILABLE_DUE_TO_DATA',
    oiDelta: 'UNAVAILABLE_DUE_TO_DATA',
    absorption: 'UNAVAILABLE_DUE_TO_DATA'
  };

  const liveMS: MicrostructureFeatures = {
    cvd: 12,
    takerImbalance: 1.8,
    oiDelta: 0.002,
    absorption: false
  };

  it('falls back to PA-only model when live microstructure cannot exactly match historical klines', () => {
    const engine = new QuantEngine({ feeRate: 0, syntheticSlippage: 0, minSamples: 2 });
    engine.recordNetObservation(pa, historicalMS, 0.01, 1000);
    engine.recordNetObservation(pa, historicalMS, 0.02, 2000);

    const score = engine.evaluate(pa, liveMS);

    expect(score.sampleCount).toBe(2);
    expect(score.expectancy).toBeCloseTo(0.015);
    expect(score.modelSource).toBe('PA_FALLBACK');
  });

  it('round-trips V2 net observations through the serialized model', () => {
    const source = new QuantEngine({ feeRate: 0.0004, syntheticSlippage: 0.0001, minSamples: 1 });
    source.recordNetObservation(pa, historicalMS, 0.012, 1500);

    const model = source.exportModel();

    const loaded = new QuantEngine({ feeRate: 0.0004, syntheticSlippage: 0.0001, minSamples: 1 });
    const count = loaded.importModel(model);
    const score = loaded.evaluate(pa, historicalMS);

    expect(model.version).toBe(2);
    expect(count).toBe(1);
    expect(score.sampleCount).toBe(1);
    expect(score.expectancy).toBeCloseTo(0.012);
    expect(score.modelSource).toBe('EXACT');
  });

  it('still imports legacy V1 observations as raw round-trip returns', () => {
    const loaded = new QuantEngine({ feeRate: 0.0004, syntheticSlippage: 0.0001, minSamples: 1 });
    loaded.importModel({
      version: 1,
      createdAt: 1,
      observations: [{
        exactHash: 'MS:LL|RNG:false|B_UP:false|B_DN:false|S_UP:false|S_DN:false|CVD:UNAVAILABLE|IMB:UNAVAILABLE|OI:UNAVAILABLE|ABS:UNAVAILABLE',
        paHash: 'MS:LL|RNG:false|B_UP:false|B_DN:false|S_UP:false|S_DN:false',
        forwardReturn: 0.002,
        holdingTimeMs: 1000
      }]
    });

    const score = loaded.evaluate(pa, historicalMS);
    expect(score.expectancy).toBeCloseTo(0.001);
  });
});


describe('QuantEngine balanced testnet matching', () => {
  const pa: PriceActionFeatures = {
    swingHighs: [],
    swingLows: [],
    marketStructure: 'LH',
    inRange: true,
    rangeHigh: 51000,
    rangeLow: 49000,
    breakoutUp: false,
    breakoutDown: false,
    liquiditySweepUp: false,
    liquiditySweepDown: false
  };

  const ms: MicrostructureFeatures = {
    cvd: 5,
    takerImbalance: 1.2,
    oiDelta: 0.001,
    absorption: false
  };

  it('combines nearby complete live states only when balanced matching is enabled', () => {
    const engine = new QuantEngine({
      feeRate: 0,
      syntheticSlippage: 0,
      minSamples: 2,
      matchMode: 'BALANCED'
    });

    engine.recordNetObservation(pa, ms, 0.0010, 60_000);
    engine.recordNetObservation(
      { ...pa, liquiditySweepUp: true },
      { ...ms, absorption: true },
      0.0014,
      60_000
    );

    const score = engine.evaluate(pa, ms);

    expect(score.modelSource).toBe('BALANCED');
    expect(score.sampleCount).toBe(2);
    expect(score.expectancy).toBeCloseTo(0.0012);
    expect(score.featureHash).toContain('REG:RANGE');
    expect(score.featureHash).toContain('BRK:NO');
  });

  it('keeps strict matching isolated from the balanced testnet bucket', () => {
    const engine = new QuantEngine({
      feeRate: 0,
      syntheticSlippage: 0,
      minSamples: 2,
      matchMode: 'STRICT'
    });

    engine.recordNetObservation(pa, ms, 0.0010, 60_000);
    engine.recordNetObservation(
      { ...pa, liquiditySweepUp: true },
      { ...ms, absorption: true },
      0.0014,
      60_000
    );

    const score = engine.evaluate(pa, ms);

    expect(score.modelSource).toBe('NONE');
    expect(score.sampleCount).toBe(1);
  });
});
