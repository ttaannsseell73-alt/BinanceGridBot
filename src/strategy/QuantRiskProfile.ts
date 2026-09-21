import { QuantExecutionMode } from './QuantExecutionPolicy';

export type QuantMatchMode = 'STRICT' | 'BALANCED';

export interface QuantRiskProfile {
  name: 'BALANCED_TESTNET' | 'STRICT_LIVE';
  matchMode: QuantMatchMode;
  minSamples: number;
  minExpectancy: number;
  safetyMultiplier: number;
  expectedCostRate: number;
}

export function getQuantRiskProfile(
  mode: QuantExecutionMode
): QuantRiskProfile {
  if (mode === 'REAL_LIVE') {
    return {
      name: 'STRICT_LIVE',
      matchMode: 'STRICT',
      minSamples: 10,
      minExpectancy: 0.001,
      safetyMultiplier: 1.5,
      expectedCostRate: 0.0018
    };
  }

  return {
    name: 'BALANCED_TESTNET',
    matchMode: 'BALANCED',
    minSamples: 6,
    minExpectancy: 0.0006,
    safetyMultiplier: 1.3,
    expectedCostRate: 0.0018
  };
}
