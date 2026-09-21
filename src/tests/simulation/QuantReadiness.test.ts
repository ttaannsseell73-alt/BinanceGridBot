import { describe, expect, it } from 'vitest';
import { analyzeQuantReadiness } from '../../simulation/QuantReadiness';
import { QuantModelV2 } from '../../strategy/QuantEngine';

function model(observations: QuantModelV2['observations']): QuantModelV2 {
  return {
    version: 2,
    createdAt: 1,
    label: 'MIXED_RETURN_BASIS',
    observations
  };
}

describe('QuantReadiness', () => {
  it('ignores historical unavailable-feature observations', () => {
    const report = analyzeQuantReadiness(model([{
      exactHash: 'MS:LH|RNG:true|B_UP:false|B_DN:false|S_UP:false|S_DN:false|CVD:UNAVAILABLE|IMB:UNAVAILABLE|OI:UNAVAILABLE|ABS:UNAVAILABLE',
      paHash: 'x',
      forwardReturn: 0.01,
      holdingTimeMs: 60_000,
      returnBasis: 'NET_GRID_EPISODE'
    }]), {
      minSamples: 1,
      minExpectancy: 0.001,
      rawRoundTripPenalty: 0.001
    });

    expect(report.liveExactObservations).toBe(0);
    expect(report.executableStates).toBe(0);
  });

  it('marks a sufficiently sampled positive non-breakout exact state as executable', () => {
    const exactHash = 'MS:LH|RNG:true|B_UP:false|B_DN:false|S_UP:false|S_DN:false|CVD:pos|IMB:neutral|OI:pos|ABS:false';
    const observations = Array.from({ length: 10 }, () => ({
      exactHash,
      paHash: 'x',
      forwardReturn: 0.0015,
      holdingTimeMs: 3_600_000,
      returnBasis: 'NET_GRID_EPISODE' as const
    }));

    const report = analyzeQuantReadiness(model(observations), {
      minSamples: 10,
      minExpectancy: 0.001,
      rawRoundTripPenalty: 0.001
    });

    expect(report.liveExactObservations).toBe(10);
    expect(report.liveExactStates).toBe(1);
    expect(report.executableStates).toBe(1);
    expect(report.states[0].executable).toBe(true);
  });

  it('never marks breakout states executable', () => {
    const exactHash = 'MS:HH|RNG:true|B_UP:true|B_DN:false|S_UP:false|S_DN:false|CVD:pos|IMB:high_buy|OI:pos|ABS:false';
    const observations = Array.from({ length: 20 }, () => ({
      exactHash,
      paHash: 'x',
      forwardReturn: 0.01,
      holdingTimeMs: 3_600_000,
      returnBasis: 'NET_GRID_EPISODE' as const
    }));

    const report = analyzeQuantReadiness(model(observations), {
      minSamples: 10,
      minExpectancy: 0.001,
      rawRoundTripPenalty: 0.001
    });

    expect(report.executableStates).toBe(0);
    expect(report.states[0].breakout).toBe(true);
  });
  it('aggregates nearby live states under the balanced testnet bucket', () => {
    const hashes = [
      'MS:LH|RNG:true|B_UP:false|B_DN:false|S_UP:false|S_DN:false|CVD:pos|IMB:neutral|OI:pos|ABS:false',
      'MS:LL|RNG:true|B_UP:false|B_DN:false|S_UP:true|S_DN:false|CVD:pos|IMB:neutral|OI:pos|ABS:true',
      'MS:LH|RNG:true|B_UP:false|B_DN:false|S_UP:false|S_DN:true|CVD:pos|IMB:high_buy|OI:pos|ABS:false',
      'MS:LL|RNG:true|B_UP:false|B_DN:false|S_UP:true|S_DN:false|CVD:pos|IMB:high_buy|OI:pos|ABS:true',
      'MS:LH|RNG:true|B_UP:false|B_DN:false|S_UP:false|S_DN:false|CVD:pos|IMB:neutral|OI:pos|ABS:true',
      'MS:LL|RNG:true|B_UP:false|B_DN:false|S_UP:false|S_DN:true|CVD:pos|IMB:neutral|OI:pos|ABS:false'
    ];

    const observations = hashes.map(exactHash => ({
      exactHash,
      paHash: 'x',
      forwardReturn: 0.0008,
      holdingTimeMs: 3_600_000,
      returnBasis: 'NET_GRID_EPISODE' as const
    }));

    const report = analyzeQuantReadiness(model(observations), {
      minSamples: 6,
      minExpectancy: 0.0006,
      rawRoundTripPenalty: 0.001,
      stateMode: 'BALANCED'
    });

    expect(report.stateMode).toBe('BALANCED');
    expect(report.liveExactObservations).toBe(6);
    expect(report.liveExactStates).toBe(1);
    expect(report.executableStates).toBe(1);
    expect(report.states[0].sampleCount).toBe(6);
    expect(report.states[0].exactHash).toContain('REG:RANGE');
    expect(report.states[0].exactHash).toContain('FLOW:BUY');
    expect(report.states[0].exactHash).toContain('BRK:NO');
  });

  it('keeps breakout observations separated and non-executable in balanced mode', () => {
    const safeHash = 'MS:LH|RNG:true|B_UP:false|B_DN:false|S_UP:false|S_DN:false|CVD:pos|IMB:neutral|OI:pos|ABS:false';
    const breakoutHash = 'MS:LH|RNG:true|B_UP:true|B_DN:false|S_UP:false|S_DN:false|CVD:pos|IMB:neutral|OI:pos|ABS:false';
    const observations = [
      ...Array.from({ length: 6 }, () => ({
        exactHash: safeHash,
        paHash: 'x',
        forwardReturn: 0.0008,
        holdingTimeMs: 3_600_000,
        returnBasis: 'NET_GRID_EPISODE' as const
      })),
      ...Array.from({ length: 6 }, () => ({
        exactHash: breakoutHash,
        paHash: 'x',
        forwardReturn: 0.01,
        holdingTimeMs: 3_600_000,
        returnBasis: 'NET_GRID_EPISODE' as const
      }))
    ];

    const report = analyzeQuantReadiness(model(observations), {
      minSamples: 6,
      minExpectancy: 0.0006,
      rawRoundTripPenalty: 0.001,
      stateMode: 'BALANCED'
    });

    expect(report.liveExactStates).toBe(2);
    expect(report.executableStates).toBe(1);
    expect(report.states.some(s => s.breakout && s.executable)).toBe(false);
  });

});
