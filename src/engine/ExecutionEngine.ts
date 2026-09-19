import { IBinanceClient, OrderRequest } from '../gateways/IBinanceClient';
import { IntentJournal } from '../db/IntentJournal';
import { LifecycleState, OrderIntent } from '../models/types';
import { logger } from '../utils/logger';

export class ExecutionEngine {
  constructor(
    private client: IBinanceClient,
    private journal: IntentJournal
  ) {}

  public async submitOrder(intent: OrderIntent): Promise<boolean> {
    if (intent.state !== LifecycleState.RISK_RESERVED) {
      logger.error({ intent }, 'Cannot submit order not in RISK_RESERVED state');
      return false;
    }

    // Transition to SUBMITTING before network call
    this.journal.updateIntentState(intent.clientOrderId, LifecycleState.SUBMITTING);

    const request: OrderRequest = {
      symbol: intent.symbol,
      side: intent.side,
      type: 'LIMIT', // V1 only limit
      timeInForce: 'GTX', // Default to Maker
      quantity: intent.originalQuantity,
      price: intent.price,
      newClientOrderId: intent.clientOrderId,
    };

    try {
      const response = await this.client.postOrder(request);
      
      // Update journal with exchange order ID and state
      // Even if response status is NEW, we consider it ACKNOWLEDGED
      let nextState = LifecycleState.ACKNOWLEDGED;
      if (response.status === 'EXPIRED' || response.status === 'REJECTED') {
        nextState = LifecycleState.CONFIRMED_REJECTED;
      }
      
      this.journal.updateIntentState(intent.clientOrderId, nextState, String(response.orderId));
      logger.info({ clientOrderId: intent.clientOrderId, orderId: response.orderId }, 'Order submitted successfully');
      return true;
    } catch (error: any) {
      logger.error({ err: error, clientOrderId: intent.clientOrderId }, 'Order submission failed or timed out');
      // Mark as SUBMIT_UNKNOWN, DO NOT resubmit immediately, keep exposure reserved
      this.journal.updateIntentState(intent.clientOrderId, LifecycleState.SUBMIT_UNKNOWN);
      return false;
    }
  }

  public async cancelOrder(intent: OrderIntent): Promise<boolean> {
    try {
      const response = await this.client.cancelOrder(intent.symbol, intent.clientOrderId);
      // Wait for WS ORDER_TRADE_UPDATE to confirm cancellation, 
      // but we can log the REST response
      logger.info({ response }, 'Cancel request sent successfully');
      return true;
    } catch (error: any) {
      logger.error({ err: error, clientOrderId: intent.clientOrderId }, 'Failed to cancel order via REST');
      return false;
    }
  }
}
