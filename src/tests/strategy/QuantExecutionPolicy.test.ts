import { describe, expect, it } from 'vitest';
import {
  assertQuantExecutionModeSafe,
  resolveQuantExecution
} from '../../strategy/QuantExecutionPolicy';
import { PriceActionFeatures, QuantScore } from '../../models/strategy';

const testnetRest = 'https://testnet.binancefuture.com';
const testnetWs = 'wss://stream.binancefuture.com';
const liveRest = 'https://fapi.binance.com';
const liveWs = 'wss://fstream.binance.com';

const smokeScore: QuantScore = {
  expectancy: 0.002,
  sampleCount: 100,
  hitRate: 0,
  averageWin: 0,
  averageLoss: 0,
  mae: 0,
  mfe: 0,
  modelSource: 'NONE'
};

const realScore: QuantScore = {
  expectancy: 0.0015,
  sampleCount: 100,
  hitRate: 0.55,
  averageWin: 0.002,
  averageLoss: -0.001,
  mae: -0.003,
  mfe: 0.004,
  modelSource: 'EXACT'
};

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

describe('QuantExecutionPolicy', () => {
  it('allows real Quant execution on testnet', () => {
    expect(() => assertQuantExecutionModeSafe({
      mode: 'REAL_TESTNET',
      restUrl: testnetRest,
      wsUrl: testnetWs
    })).not.toThrow();
  });

  it('rejects testnet execution modes on live endpoints', () => {
    expect(() => assertQuantExecutionModeSafe({
      mode: 'REAL_TESTNET',
      restUrl: liveRest,
      wsUrl: liveWs
    })).toThrow(/outside Binance Futures testnet/i);

    expect(() => assertQuantExecutionModeSafe({
      mode: 'SMOKE_TESTNET',
      restUrl: liveRest,
      wsUrl: liveWs
    })).toThrow(/outside Binance Futures testnet/i);
  });

  it('requires a second explicit acknowledgement for real live Quant', () => {
    expect(() => assertQuantExecutionModeSafe({
      mode: 'REAL_LIVE',
      restUrl: liveRest,
      wsUrl: liveWs
    })).toThrow(/I_UNDERSTAND_QUANT_LIVE=yes/);

    expect(() => assertQuantExecutionModeSafe({
      mode: 'REAL_LIVE',
      restUrl: liveRest,
      wsUrl: liveWs,
      liveQuantAcknowledgement: 'yes'
    })).not.toThrow();
  });

  it('shadow mode never returns an execution score', () => {
    const decision = resolveQuantExecution({
      mode: 'SHADOW',
      realQuantScore: realScore,
      activePriceAction: pa,
      smokeScore
    });

    expect(decision.canExecute).toBe(false);
    expect(decision.reason).toBe('SHADOW_MODE');
  });

  it('real mode fails closed for PA-only fallback or no matching state', () => {
    const noMatch = { ...realScore, modelSource: 'PA_FALLBACK' as const };
    const decision = resolveQuantExecution({
      mode: 'REAL_TESTNET',
      realQuantScore: noMatch,
      activePriceAction: pa,
      smokeScore
    });

    expect(decision.canExecute).toBe(false);
    expect(decision.reason).toBe('REAL_QUANT_UNAVAILABLE');

    const none = resolveQuantExecution({
      mode: 'REAL_TESTNET',
      realQuantScore: { ...realScore, modelSource: 'NONE' },
      activePriceAction: pa,
      smokeScore
    });
    expect(none.canExecute).toBe(false);
  });

  it('real mode passes only an exact live-feature score when ready', () => {
    const decision = resolveQuantExecution({
      mode: 'REAL_TESTNET',
      realQuantScore: realScore,
      activePriceAction: pa,
      smokeScore
    });

    expect(decision.canExecute).toBe(true);
    expect(decision.score).toBe(realScore);
    expect(decision.priceAction).toBe(pa);
    expect(decision.reason).toBe('REAL_QUANT_READY');
  });
});
