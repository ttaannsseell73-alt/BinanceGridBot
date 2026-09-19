import { IBinanceClient } from '../gateways/IBinanceClient';
import { IntentJournal } from '../db/IntentJournal';
import { LifecycleState, OrderIntent } from '../models/types';
import { logger } from '../utils/logger';

/**
 * Reconciles the local intent journal against Binance without issuing one REST
 * request per stale local intent. A cycle uses two bounded account requests:
 * current open orders + recent order history. This avoids startup request storms.
 */
export class Reconciler {
  public isHalted = false;

  constructor(
    private client: IBinanceClient,
    private journal: IntentJournal,
    private symbol: string
  ) {}

  public async reconcile(): Promise<boolean> {
    if (this.isHalted) return false;
    logger.info('Starting reconciliation cycle');

    try {
      // Bounded reconciliation: never N x getOrder() for N stale local intents.
      const openOrders = await this.client.getOpenOrders(this.symbol);
      const recentOrders = await this.client.getAllOrders(this.symbol, 1000);

      const openIntents = this.journal.getOpenIntents();
      const exchangeOpenMap = new Map(openOrders.map(o => [o.clientOrderId, o]));
      const exchangeHistoryMap = new Map(recentOrders.map(o => [o.clientOrderId, o]));
      const intentMap = new Map(openIntents.map(i => [i.clientOrderId, i]));

      // 1. Any currently open exchange order not owned by our local journal is unsafe.
      for (const order of openOrders) {
        if (!intentMap.has(order.clientOrderId)) {
          logger.fatal({ order }, 'OWNERSHIP_VIOLATION: Foreign order detected');
          this.halt();
          return false;
        }
      }

      // 2. Resolve local non-terminal intents from the two bounded snapshots.
      for (const intent of openIntents) {
        const exchangeOpen = exchangeOpenMap.get(intent.clientOrderId);

        if (exchangeOpen) {
          if (
            intent.state === LifecycleState.SUBMIT_UNKNOWN ||
            intent.state === LifecycleState.SUBMITTING
          ) {
            logger.info(
              { clientOrderId: intent.clientOrderId },
              'Reconciled SUBMIT_UNKNOWN to ACKNOWLEDGED'
            );
            this.journal.updateIntentState(
              intent.clientOrderId,
              LifecycleState.ACKNOWLEDGED,
              String(exchangeOpen.orderId)
            );
          } else if (
            intent.exchangeOrderId !== String(exchangeOpen.orderId) &&
            intent.exchangeOrderId !== null
          ) {
            logger.error(
              { intent, exchangeOrder: exchangeOpen },
              'Exchange order ID mismatch during reconciliation'
            );
          }
          continue;
        }

        const historicalOrder = exchangeHistoryMap.get(intent.clientOrderId);
        if (historicalOrder) {
          this.syncIntentFromRestStatus(intent, historicalOrder);
          continue;
        }

        // A recent SUBMIT_UNKNOWN/SUBMITTING order absent from both current and
        // recent Binance order history is deterministically treated as rejected.
        if (
          intent.state === LifecycleState.SUBMIT_UNKNOWN ||
          intent.state === LifecycleState.SUBMITTING
        ) {
          logger.warn(
            { clientOrderId: intent.clientOrderId },
            'Order absent from bounded exchange history. Marking CONFIRMED_REJECTED to free risk.'
          );
          this.journal.updateIntentState(
            intent.clientOrderId,
            LifecycleState.CONFIRMED_REJECTED
          );
          continue;
        }

        // For an order we previously believed was acknowledged/working, absence
        // from both snapshots is ambiguous (e.g. history window exhausted). Fail closed.
        logger.error(
          { intent },
          'ACKNOWLEDGED order missing from bounded exchange history. Marking UNKNOWN'
        );
        this.journal.updateIntentState(intent.clientOrderId, LifecycleState.UNKNOWN);
        this.halt();
        return false;
      }

      logger.info({
        openExchangeOrders: openOrders.length,
        recentExchangeOrders: recentOrders.length,
        openLocalIntents: openIntents.length
      }, 'Reconciliation cycle complete');
      return true;
    } catch (error: any) {
      // Fail closed: do not mutate local intent state when Binance history cannot
      // be obtained. Most importantly, do not fan out into per-order retries.
      logger.error({ err: error }, 'Reconciliation cycle failed');
      return false;
    }
  }

  private syncIntentFromRestStatus(intent: OrderIntent, statusObj: any) {
    const status = statusObj.status;
    let newState = intent.state;

    if (status === 'NEW') newState = LifecycleState.ACKNOWLEDGED;
    else if (status === 'FILLED') newState = LifecycleState.CONFIRMED_FILLED;
    else if (status === 'CANCELED' || status === 'EXPIRED' || status === 'EXPIRED_IN_MATCH') {
      newState = LifecycleState.CONFIRMED_CANCELED;
    } else if (status === 'REJECTED') newState = LifecycleState.CONFIRMED_REJECTED;
    else if (status === 'PARTIALLY_FILLED') newState = LifecycleState.PARTIALLY_FILLED;

    const executedQty = Number(statusObj.executedQty);
    const safeExecutedQty = Number.isFinite(executedQty) ? executedQty : intent.cumulativeExecutedQuantity;
    const remainingQty = Math.max(0, intent.originalQuantity - safeExecutedQty);

    this.journal.updateIntentExecution(
      intent.clientOrderId,
      remainingQty,
      safeExecutedQty,
      newState
    );

    if (intent.exchangeOrderId === null && statusObj.orderId !== undefined) {
      this.journal.updateIntentState(
        intent.clientOrderId,
        newState,
        String(statusObj.orderId)
      );
    }

    if (newState !== intent.state) {
      logger.info(
        { clientOrderId: intent.clientOrderId, oldState: intent.state, newState },
        'Reconciled intent state from REST history'
      );
    }
  }

  private halt() {
    this.isHalted = true;
    logger.fatal('SYSTEM HALTED by Reconciler');
  }
}
