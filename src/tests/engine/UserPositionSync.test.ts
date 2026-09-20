import { describe, expect, it } from 'vitest';
import {
  extractOneWayPositionAmount,
  getUserEventTime,
  isTradeFillUpdate
} from '../../engine/UserPositionSync';

describe('UserPositionSync', () => {
  it('extracts absolute one-way position for the configured symbol', () => {
    const payload = {
      e: 'ACCOUNT_UPDATE',
      T: 123,
      a: {
        P: [
          { s: 'ETHUSDT', pa: '1.25', ps: 'BOTH' },
          { s: 'BTCUSDT', pa: '-0.03125', ps: 'BOTH' }
        ]
      }
    };

    expect(extractOneWayPositionAmount(payload, 'BTCUSDT')).toBe(-0.03125);
    expect(getUserEventTime(payload)).toBe(123);
  });

  it('ignores missing symbols and hedge-side rows', () => {
    expect(extractOneWayPositionAmount({
      e: 'ACCOUNT_UPDATE',
      a: { P: [{ s: 'ETHUSDT', pa: '1', ps: 'BOTH' }] }
    }, 'BTCUSDT')).toBeNull();

    expect(extractOneWayPositionAmount({
      e: 'ACCOUNT_UPDATE',
      a: { P: [{ s: 'BTCUSDT', pa: '0.2', ps: 'LONG' }] }
    }, 'BTCUSDT')).toBeNull();
  });

  it('rejects malformed absolute position amounts', () => {
    expect(() => extractOneWayPositionAmount({
      e: 'ACCOUNT_UPDATE',
      a: { P: [{ s: 'BTCUSDT', pa: 'not-a-number', ps: 'BOTH' }] }
    }, 'BTCUSDT')).toThrow(/Invalid ACCOUNT_UPDATE/);
  });

  it('identifies only real trade-fill order updates', () => {
    expect(isTradeFillUpdate({
      e: 'ORDER_TRADE_UPDATE',
      o: { l: '0.1', t: 77 }
    })).toBe(true);

    expect(isTradeFillUpdate({
      e: 'ORDER_TRADE_UPDATE',
      o: { l: '0', t: 77 }
    })).toBe(false);

    expect(isTradeFillUpdate({
      e: 'ORDER_TRADE_UPDATE',
      o: { l: '0.1', t: 0 }
    })).toBe(false);
  });
});
