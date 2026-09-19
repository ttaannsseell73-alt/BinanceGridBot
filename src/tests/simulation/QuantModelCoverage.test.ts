import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { MicrostructureFeatures, PriceActionFeatures } from '../../models/strategy';
import { QuantEngine, QuantModel } from '../../strategy/QuantEngine';

describe('Committed quant model coverage', () => {
  it('covers the warmed LH/range live state through PA fallback', () => {
    const modelPath = path.join(process.cwd(), 'artifacts', 'quant_model_BTCUSDT.json');
    const model = JSON.parse(fs.readFileSync(modelPath, 'utf8')) as QuantModel;

    const engine = new QuantEngine({
      feeRate: 0.0004,
      syntheticSlippage: 0.0001,
      minSamples: 10
    });

    const loaded = engine.importModel(model);
    expect(loaded).toBeGreaterThan(1000);

    const pa: PriceActionFeatures = {
      swingHighs: [],
      swingLows: [],
      marketStructure: 'LH',
      inRange: true,
      rangeHigh: null,
      rangeLow: null,
      breakoutUp: false,
      breakoutDown: false,
      liquiditySweepUp: false,
      liquiditySweepDown: false
    };

    const liveMs: MicrostructureFeatures = {
      cvd: 1,
      takerImbalance: 1.2,
      oiDelta: 0.0001,
      absorption: false
    };

    const score = engine.evaluate(pa, liveMs);

    expect(score.modelSource).toBe('PA_FALLBACK');
    expect(score.sampleCount).toBeGreaterThanOrEqual(10);
    expect(Number.isFinite(score.expectancy)).toBe(true);
  });
});
