import { describe, expect, it } from 'vitest';
import { sanitizeShadowStartup } from '../../engine/ShadowStartupCleanup';
import { FakeBinanceClient } from '../FakeBinanceClient';
import { FakeBinanceExchange } from '../FakeBinanceExchange';

describe('ShadowStartupCleanup', () => {
  it('does nothing when clean-start is disabled', async () => {
    const exchange = new FakeBinanceExchange();
    const client = new FakeBinanceClient(exchange);

    exchange.positionAmount = 0.25;

    const result = await sanitizeShadowStartup(
      client,
      'BTCUSDT',
      false
    );

    expect(result.performed).toBe(false);
    expect(exchange.positionAmount).toBe(0.25);
    expect(exchange.emergencyCloseCalls).toBe(0);
  });

  it('flattens an existing position before symbol margin configuration', async () => {
    const exchange = new FakeBinanceExchange();
    const client = new FakeBinanceClient(exchange);

    exchange.positionAmount = 0.25;
    exchange.marginType = 'CROSSED';
    exchange.leverage = 10;

    exchange.placeOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 0.1,
      price: 49000,
      timeInForce: 'GTC',
      newClientOrderId: 'stale-shadow-order'
    });

    const result = await sanitizeShadowStartup(
      client,
      'BTCUSDT',
      true
    );

    expect(result.performed).toBe(true);
    expect(result.exit?.closedPositionAmount).toBe(0.25);
    expect(exchange.positionAmount).toBe(0);
    expect(exchange.getActiveOrders()).toHaveLength(0);
    expect(exchange.emergencyCloseCalls).toBe(1);
  });
});
