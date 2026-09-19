import { describe, it, expect } from 'vitest';
import { FakeBinanceExchange } from '../FakeBinanceExchange';
import { FakeBinanceClient } from '../FakeBinanceClient';
import { IntentJournal } from '../../db/IntentJournal';
import { RiskGuard } from '../../engine/RiskGuard';
import { ExecutionEngine } from '../../engine/ExecutionEngine';
import { Reconciler } from '../../engine/Reconciler';
import { LifecycleState, OrderIntent } from '../../models/types';

function makeIntent(id: string): OrderIntent {
  return {
    clientOrderId: id,
    exchangeOrderId: null,
    symbol: 'BTCUSDT',
    side: 'BUY',
    price: 40000,
    originalQuantity: 1,
    remainingQuantity: 1,
    cumulativeExecutedQuantity: 0,
    state: LifecycleState.INTENT_CREATED,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

describe('Reconciler bounded REST usage', () => {
  it('resolves a hidden completed order from batched history without per-order getOrder', async () => {
    const exchange = new FakeBinanceExchange();
    const client = new FakeBinanceClient(exchange);
    const journal = new IntentJournal(':memory:');
    const risk = new RiskGuard(journal, 5, 5, 1000000);
    const execution = new ExecutionEngine(client, journal);
    const reconciler = new Reconciler(client, journal, 'BTCUSDT');

    const intent = makeIntent('batch-history-1');
    risk.reserveAndSaveIntent(intent);

    exchange.simulateWsDisconnect = true;
    await execution.submitOrder(intent);
    exchange.simulateFill(intent.clientOrderId, 1);

    let getOrderCalls = 0;
    const originalGetOrder = client.getOrder.bind(client);
    client.getOrder = async (...args) => {
      getOrderCalls++;
      return originalGetOrder(...args);
    };

    await reconciler.reconcile();

    expect(getOrderCalls).toBe(0);
    expect(journal.getIntent(intent.clientOrderId)!.state).toBe(LifecycleState.CONFIRMED_FILLED);
    expect(reconciler.isHalted).toBe(false);

    journal.close();
  });
});
