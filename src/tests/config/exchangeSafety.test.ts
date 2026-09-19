import { describe, expect, it } from 'vitest';
import { assertExchangeEnvironmentSafe } from '../../config/exchangeSafety';

describe('exchange environment safety', () => {
  it('allows the configured Binance Futures testnet pair without live acknowledgement', () => {
    expect(() => assertExchangeEnvironmentSafe({
      restUrl: 'https://testnet.binancefuture.com',
      wsUrl: 'wss://stream.binancefuture.com'
    })).not.toThrow();
  });

  it('rejects mixed testnet/live endpoints', () => {
    expect(() => assertExchangeEnvironmentSafe({
      restUrl: 'https://testnet.binancefuture.com',
      wsUrl: 'wss://fstream.binance.com'
    })).toThrow(/mixed Binance environments/i);
  });

  it('rejects non-testnet endpoints without explicit acknowledgement', () => {
    expect(() => assertExchangeEnvironmentSafe({
      restUrl: 'https://fapi.binance.com',
      wsUrl: 'wss://fstream.binance.com'
    })).toThrow(/I_UNDERSTAND_LIVE=yes/);
  });

  it('allows non-testnet endpoints only with explicit acknowledgement', () => {
    expect(() => assertExchangeEnvironmentSafe({
      restUrl: 'https://fapi.binance.com',
      wsUrl: 'wss://fstream.binance.com',
      liveAcknowledgement: 'yes'
    })).not.toThrow();
  });
});
