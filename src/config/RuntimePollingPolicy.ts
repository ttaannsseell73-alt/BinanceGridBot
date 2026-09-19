import { QuantExecutionMode } from '../strategy/QuantExecutionPolicy';

export interface RuntimePollingIntervals {
  openInterestMs: number;
  reconciliationMs: number;
  positionRiskMs: number;
}

const ACTIVE_INTERVALS: RuntimePollingIntervals = {
  openInterestMs: 5_000,
  reconciliationMs: 60_000,
  positionRiskMs: 15_000
};

const SHADOW_INTERVALS: RuntimePollingIntervals = {
  openInterestMs: 15_000,
  reconciliationMs: 300_000,
  positionRiskMs: 300_000
};

/**
 * SHADOW never places exposure and starts from a verified-flat account.
 * Keep OI fresh enough for 1m feature snapshots, but avoid unnecessary
 * private-account REST polling on Binance testnet where shared-IP limits can
 * otherwise be hit by long-running collectors.
 */
export function getRuntimePollingIntervals(
  mode: QuantExecutionMode
): RuntimePollingIntervals {
  return mode === 'SHADOW'
    ? { ...SHADOW_INTERVALS }
    : { ...ACTIVE_INTERVALS };
}
