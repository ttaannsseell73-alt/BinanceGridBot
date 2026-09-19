import { describe, expect, it } from 'vitest';
import {
  ensureStartupSymbolRiskConfig,
  TARGET_LEVERAGE,
  TARGET_MARGIN_TYPE
} from '../../engine/StartupSymbolConfig';
import { FakeBinanceClient } from '../FakeBinanceClient';
import { FakeBinanceExchange } from '../FakeBinanceExchange';

describe('startup symbol risk configuration', () => {
  it('keeps the canonical isolated 2x configuration unchanged', async () => {
    const exchange = new FakeBinanceExchange();
    const client = new FakeBinanceClient(exchange);

    const result = await ensureStartupSymbolRiskConfig(client, 'BTCUSDT');

    expect(result.marginType).toBe(TARGET_MARGIN_TYPE);
    expect(result.leverage).toBe(TARGET_LEVERAGE);
    expect(exchange.marginType).toBe('ISOLATED');
    expect(exchange.leverage).toBe(2);
  });

  it('corrects margin type and leverage then verifies them', async () => {
    const exchange = new FakeBinanceExchange();
    exchange.marginType = 'CROSSED';
    exchange.leverage = 20;

    const client = new FakeBinanceClient(exchange);

    const result = await ensureStartupSymbolRiskConfig(client, 'BTCUSDT');

    expect(result.marginType).toBe('ISOLATED');
    expect(result.leverage).toBe(2);
    expect(exchange.marginType).toBe('ISOLATED');
    expect(exchange.leverage).toBe(2);
  });

  it('fails closed if Binance account configuration cannot be read', async () => {
    const exchange = new FakeBinanceExchange();
    exchange.simulateRestTimeout = true;

    const client = new FakeBinanceClient(exchange);

    await expect(
      ensureStartupSymbolRiskConfig(client, 'BTCUSDT')
    ).rejects.toThrow(/Timeout/);
  });
});
