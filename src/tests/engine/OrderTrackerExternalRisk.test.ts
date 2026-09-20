import { describe, expect, it } from 'vitest';
import { IntentJournal } from '../../db/IntentJournal';
import { OrderTracker } from '../../engine/OrderTracker';
import { RiskGuard } from '../../engine/RiskGuard';
import { LifecycleState, OrderIntent } from '../../models/types';

describe('OrderTracker external position mode', () => {
  it('journals fills without double-incrementing RiskGuard position', () => {
    const journal = new IntentJournal(':memory:');
    const risk = new RiskGuard(journal, 1, 1, 100000);
    const tracker = new OrderTracker(journal, risk, false);

    const intent: OrderIntent = {
      clientOrderId: 'grid-external-risk',
      exchangeOrderId: '42',
      symbol: 'BTCUSDT',
      side: 'BUY',
      price: 50000,
      originalQuantity: 0.1,
      remainingQuantity: 0.1,
      cumulativeExecutedQuantity: 0,
      state: LifecycleState.ACKNOWLEDGED,
      createdAt: 1,
      updatedAt: 1
    };

    journal.saveIntent(intent);

    tracker.handleTradeUpdate({
      e: 'ORDER_TRADE_UPDATE',
      T: 1234,
      o: {
        c: intent.clientOrderId,
        i: 42,
        X: 'FILLED',
        z: '0.1',
        l: '0.1',
        t: 777,
        p: '50000'
      }
    });

    expect(risk.getCurrentPosition()).toBe(0);
    expect(journal.getIntent(intent.clientOrderId)?.state).toBe(
      LifecycleState.CONFIRMED_FILLED
    );

    journal.close();
  });
});
