import { describe, expect, it } from 'vitest';
import { executeEmergencyExit } from '../../engine/EmergencyExitEngine';
import { FakeBinanceClient } from '../FakeBinanceClient';
import { FakeBinanceExchange } from '../FakeBinanceExchange';

describe('EmergencyExitEngine', () => {
  it('cancels all resting orders, closes position and verifies flat', async () => {
    const exchange = new FakeBinanceExchange();
    const client = new FakeBinanceClient(exchange);

    exchange.setPrice(50000);
    exchange.positionAmount = 0.25;
    exchange.entryPrice = 50000;
    exchange.markPrice = 49000;
    exchange.liquidationPrice = 47000;

    exchange.placeOrder({
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 0.1,
      price: 49000,
      timeInForce: 'GTC',
      newClientOrderId: 'risk-open-1'
    });

    exchange.placeOrder({
      symbol: 'BTCUSDT',
      side: 'SELL',
      type: 'LIMIT',
      quantity: 0.1,
      price: 51000,
      timeInForce: 'GTC',
      newClientOrderId: 'risk-open-2'
    });

    const result = await executeEmergencyExit(client, 'BTCUSDT');

    expect(exchange.getActiveOrders()).toHaveLength(0);
    expect(exchange.positionAmount).toBe(0);
    expect(exchange.emergencyCloseCalls).toBe(1);
    expect(exchange.lastEmergencyCloseAmount).toBe(0.25);
    expect(result.closedPositionAmount).toBe(0.25);
  });

  it('does not submit an emergency close when already flat', async () => {
    const exchange = new FakeBinanceExchange();
    const client = new FakeBinanceClient(exchange);

    const result = await executeEmergencyExit(client, 'BTCUSDT');

    expect(exchange.emergencyCloseCalls).toBe(0);
    expect(result.closedPositionAmount).toBe(0);
  });
});
