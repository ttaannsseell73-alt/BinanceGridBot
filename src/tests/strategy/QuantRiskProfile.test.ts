import { describe, expect, it } from 'vitest';
import { getQuantRiskProfile } from '../../strategy/QuantRiskProfile';

describe('QuantRiskProfile', () => {
  it('uses the balanced medium-risk gate for SHADOW and REAL_TESTNET', () => {
    for (const mode of ['SHADOW', 'REAL_TESTNET'] as const) {
      const profile = getQuantRiskProfile(mode);
      expect(profile.name).toBe('BALANCED_TESTNET');
      expect(profile.matchMode).toBe('BALANCED');
      expect(profile.minSamples).toBe(6);
      expect(profile.minExpectancy).toBe(0.0006);
      expect(profile.safetyMultiplier).toBe(1.3);
    }
  });

  it('keeps REAL_LIVE on the stricter exact gate', () => {
    const profile = getQuantRiskProfile('REAL_LIVE');
    expect(profile.name).toBe('STRICT_LIVE');
    expect(profile.matchMode).toBe('STRICT');
    expect(profile.minSamples).toBe(10);
    expect(profile.minExpectancy).toBe(0.001);
    expect(profile.safetyMultiplier).toBe(1.5);
  });
});
