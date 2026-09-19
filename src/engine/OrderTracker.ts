import { IntentJournal } from '../db/IntentJournal';
import { RiskGuard } from './RiskGuard';
import { LifecycleState, FillIdentity } from '../models/types';
import { logger } from '../utils/logger';

export class OrderTracker {
  constructor(
    private journal: IntentJournal,
    private riskGuard: RiskGuard
  ) {}

  public handleTradeUpdate(payload: any) {
    // Expected payload is from Binance ORDER_TRADE_UPDATE
    // o.c = clientOrderId
    // o.X = status (NEW, PARTIALLY_FILLED, FILLED, CANCELED, REJECTED, EXPIRED)
    // o.z = cumulative filled quantity
    // o.l = last filled quantity
    // o.t = trade id
    // o.p = price
    // o.i = exchange order id

    const o = payload?.o;
    if (!o || !o.c) return;

    const intent = this.journal.getIntent(o.c);
    if (!intent) {
      // Possible ghost order or OWNERSHIP_VIOLATION
      // If we don't own it, we must HALT, but Reconciler handles OWNERSHIP_VIOLATION
      // For now, log it.
      logger.warn({ payload }, 'Received WS update for unknown clientOrderId');
      return;
    }

    const exchangeOrderId = String(o.i);
    const status = o.X;
    const cumQty = parseFloat(o.z);
    const lastFilledQty = parseFloat(o.l);
    const tradeId = String(o.t);
    const price = parseFloat(o.p);

    if (intent.exchangeOrderId && intent.exchangeOrderId !== exchangeOrderId) {
      logger.error({ intent, exchangeOrderId }, 'Exchange order ID mismatch');
    }

    let newState = intent.state;

    // Update state based on status
    if (status === 'NEW') {
      if (intent.state === 'SUBMIT_UNKNOWN' || intent.state === 'SUBMITTING' || intent.state === 'ACKNOWLEDGED') {
         newState = LifecycleState.ACKNOWLEDGED;
      }
    } else if (status === 'PARTIALLY_FILLED') {
      if (intent.state !== LifecycleState.CONFIRMED_FILLED) {
        newState = LifecycleState.PARTIALLY_FILLED;
      }
    } else if (status === 'FILLED') {
      newState = LifecycleState.CONFIRMED_FILLED;
    } else if (status === 'CANCELED' || status === 'EXPIRED') {
      newState = LifecycleState.CONFIRMED_CANCELED;
    } else if (status === 'REJECTED') {
      newState = LifecycleState.CONFIRMED_REJECTED;
    }

    const isFill = lastFilledQty > 0 && tradeId && tradeId !== '0';

    if (isFill) {
      const fill: FillIdentity = {
        symbol: intent.symbol,
        exchangeOrderId,
        tradeId,
        clientOrderId: intent.clientOrderId,
        price,
        quantity: lastFilledQty,
        timestamp: payload.T || Date.now()
      };

      const remainingQty = intent.originalQuantity - cumQty;
      const processed = this.journal.processFill(fill, remainingQty, cumQty, newState);
      
      if (processed) {
        // Update RiskGuard position
        this.riskGuard.updatePositionFromFill(intent.side, lastFilledQty);
        logger.info({ fill, newState }, 'Processed fill and updated position');
      } else {
        logger.warn({ fill }, 'Ignored duplicate fill');
      }
    } else {
      // Just a state update (e.g., NEW, CANCELED)
      if (newState !== intent.state) {
        this.journal.updateIntentState(intent.clientOrderId, newState, exchangeOrderId);
        logger.info({ clientOrderId: intent.clientOrderId, newState }, 'Updated order state');
      }
    }
  }
}
