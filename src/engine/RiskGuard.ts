import { IntentJournal } from '../db/IntentJournal';
import { OrderIntent, LifecycleState, PositionExposure } from '../models/types';
import { logger } from '../utils/logger';

export class RiskGuard {
  private journal: IntentJournal;
  private currentPosition: number = 0; // > 0 long, < 0 short
  private maxLongExposure: number;
  private maxShortExposure: number;
  private maxTotalNotional: number; // Ignored for now, assuming 1 unit of BTC

  constructor(journal: IntentJournal, maxLong: number, maxShort: number, maxNotional: number) {
    this.journal = journal;
    this.maxLongExposure = maxLong;
    this.maxShortExposure = maxShort;
    this.maxTotalNotional = maxNotional;
  }

  public syncPosition(positionAmt: number) {
    this.currentPosition = positionAmt;
    logger.info({ positionAmt }, 'RiskGuard position synchronized');
  }

  public calculateExposure(): PositionExposure {
    const intents = this.journal.getOpenIntents();
    let buyExposure = 0;
    let sellExposure = 0;

    for (const intent of intents) {
      if (intent.side === 'BUY') {
        buyExposure += intent.remainingQuantity;
      } else if (intent.side === 'SELL') {
        sellExposure += intent.remainingQuantity;
      }
    }

    const worstLong = Math.max(0, this.currentPosition) + buyExposure;
    const worstShort = Math.max(0, -this.currentPosition) + sellExposure;

    return {
      worstLong: Number(worstLong.toFixed(8)),
      worstShort: Number(worstShort.toFixed(8)),
    };
  }

  public reserveAndSaveIntent(intent: OrderIntent): boolean {
    const currentExposure = this.calculateExposure();

    let newWorstLong = currentExposure.worstLong;
    let newWorstShort = currentExposure.worstShort;

    if (intent.side === 'BUY') {
      newWorstLong += intent.remainingQuantity;
    } else {
      newWorstShort += intent.remainingQuantity;
    }

    // Floating point math handling
    newWorstLong = Number(newWorstLong.toFixed(8));
    newWorstShort = Number(newWorstShort.toFixed(8));

    if (newWorstLong > this.maxLongExposure) {
      logger.warn({ intent, newWorstLong, max: this.maxLongExposure }, 'Risk reservation rejected (Long exposure limit)');
      return false;
    }

    if (newWorstShort > this.maxShortExposure) {
      logger.warn({ intent, newWorstShort, max: this.maxShortExposure }, 'Risk reservation rejected (Short exposure limit)');
      return false;
    }

    // Verify notional (simple approximation using order price * remaining qty, plus pos)
    // For V1, we rely mostly on qty limits, but let's add basic notional
    const notionalValue = (newWorstLong + newWorstShort) * intent.price;
    if (notionalValue > this.maxTotalNotional) {
       logger.warn({ notionalValue, max: this.maxTotalNotional }, 'Risk reservation rejected (Notional limit)');
       return false;
    }

    // Transition to RISK_RESERVED
    intent.state = LifecycleState.RISK_RESERVED;
    intent.updatedAt = Date.now();

    try {
      this.journal.saveIntent(intent);
      return true;
    } catch (err) {
      logger.error({ err, intent }, 'Failed to save intent in journal');
      return false;
    }
  }

  public updatePositionFromFill(side: 'BUY' | 'SELL', quantity: number) {
    if (side === 'BUY') {
      this.currentPosition += quantity;
    } else {
      this.currentPosition -= quantity;
    }
    // Handle floating point weirdness
    this.currentPosition = Number(this.currentPosition.toFixed(8));
  }

  public getCurrentPosition(): number {
    return this.currentPosition;
  }
}
