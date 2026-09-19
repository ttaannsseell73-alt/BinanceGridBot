import { describe, expect, it } from 'vitest';
import { extractOneWayPositionAmount } from '../../engine/UserPositionSync';

describe('user position synchronization', () => {
  it('extracts the absolute one-way position for the configured symbol', () => {
    const payload = {
      e: 'ACCOUNT_UPDATE',
      a: {
        P: [
          { s: 'ETHUSDT', pa: '1.25', ps: 'BOTH' },
          { s: 'BTCUSDT', pa: '-0.03125', ps: 'BOTH' }
        ]
      }
    };

    expect(extractOneWayPositionAmount(payload, 'BTCUSDT')).toBe(-0.03125);
  });

  it('ignores account updates that do not include the configured symbol', () => {
    const payload = {
      e: 'ACCOUNT_UPDATE',
      a: { P: [{ s: 'ETHUSDT', pa: '1', ps: 'BOTH' }] }
    };

    expect(extractOneWayPositionAmount(payload, 'BTCUSDT')).toBeNull();
  });

  it('does not interpret hedge-side rows as one-way position state', () => {
    const payload = {
      e: 'ACCOUNT_UPDATE',
      a: { P: [{ s: 'BTCUSDT', pa: '0.2', ps: 'LONG' }] }
    };

    expect(extractOneWayPositionAmount(payload, 'BTCUSDT')).toBeNull();
  });

  it('rejects malformed position amounts', () => {
    const payload = {
      e: 'ACCOUNT_UPDATE',
      a: { P: [{ s: 'BTCUSDT', pa: 'not-a-number', ps: 'BOTH' }] }
    };

    expect(() => extractOneWayPositionAmount(payload, 'BTCUSDT')).toThrow(/Invalid ACCOUNT_UPDATE/);
  });
});
