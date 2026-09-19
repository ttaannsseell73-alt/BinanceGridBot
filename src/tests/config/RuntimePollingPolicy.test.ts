import { describe, expect, it } from 'vitest';
import { getRuntimePollingIntervals } from '../../config/RuntimePollingPolicy';

describe('RuntimePollingPolicy', () => {
  it('throttles REST-heavy polling in SHADOW while keeping OI live', () => {
    expect(getRuntimePollingIntervals('SHADOW')).toEqual({
      openInterestMs: 15_000,
      reconciliationMs: 300_000,
      positionRiskMs: 300_000
    });
  });

  it.each(['SMOKE_TESTNET', 'REAL_TESTNET', 'REAL_LIVE'] as const)(
    'keeps active execution cadence for %s',
    (mode) => {
      expect(getRuntimePollingIntervals(mode)).toEqual({
        openInterestMs: 5_000,
        reconciliationMs: 60_000,
        positionRiskMs: 15_000
      });
    }
  );
});
