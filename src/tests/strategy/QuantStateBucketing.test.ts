import { describe, expect, it } from 'vitest';
import { MicrostructureFeatures, PriceActionFeatures } from '../../models/strategy';
import {
  buildBalancedFeatureHash,
  buildBalancedFeatureHashFromExactHash
} from '../../strategy/QuantStateBucketing';

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
  cvd: 3,
  takerImbalance: 1.2,
  oiDelta: 0.001,
  absorption: false
};

describe('QuantStateBucketing', () => {
  it('collapses sweep and absorption variants into the same balanced state', () => {
    const a = buildBalancedFeatureHash(pa, ms);
    const b = buildBalancedFeatureHash(
      { ...pa, liquiditySweepUp: true },
      { ...ms, absorption: true }
    );

    expect(a).toBe(b);
    expect(a).toBe('REG:RANGE|FLOW:BUY|OI:BUILDING|BRK:NO');
  });

  it('keeps breakout states separate', () => {
    const safe = buildBalancedFeatureHash(pa, ms);
    const breakout = buildBalancedFeatureHash(
      { ...pa, breakoutUp: true },
      ms
    );

    expect(safe).not.toBe(breakout);
    expect(breakout).toContain('BRK:YES');
  });

  it('derives the same bucket from persisted exact hashes', () => {
    const exact =
      'MS:LH|RNG:true|B_UP:false|B_DN:false|S_UP:true|S_DN:false|CVD:pos|IMB:neutral|OI:pos|ABS:true';

    expect(buildBalancedFeatureHashFromExactHash(exact)).toBe(
      'REG:RANGE|FLOW:BUY|OI:BUILDING|BRK:NO'
    );
  });

  it('never buckets historical unavailable microstructure', () => {
    const exact =
      'MS:LH|RNG:true|B_UP:false|B_DN:false|S_UP:false|S_DN:false|CVD:UNAVAILABLE|IMB:UNAVAILABLE|OI:UNAVAILABLE|ABS:UNAVAILABLE';

    expect(buildBalancedFeatureHashFromExactHash(exact)).toBeNull();
  });
});
