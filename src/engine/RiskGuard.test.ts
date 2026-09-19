import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RiskGuard } from './RiskGuard';
import { IntentJournal } from '../db/IntentJournal';
import { LifecycleState, OrderIntent } from '../models/types';
import fs from 'fs';
import path from 'path';

describe('RiskGuard', () => {
  const dbPath = path.join(__dirname, '../../data/test-riskguard.db');
  let journal: IntentJournal;
  let riskGuard: RiskGuard;

  beforeEach(() => {
    journal = new IntentJournal(dbPath);
    journal.wipeAllDataForTesting();
    riskGuard = new RiskGuard(journal, 2.0, 2.0, 1000000);
  });

  afterEach(() => {
    try {
      fs.unlinkSync(dbPath);
      fs.unlinkSync(`${dbPath}-wal`);
      fs.unlinkSync(`${dbPath}-shm`);
    } catch (e) {
      // ignore
    }
  });

  it('should accept valid intents and reserve risk', () => {
    const intent: OrderIntent = {
      clientOrderId: 'test-1',
      exchangeOrderId: null,
      symbol: 'BTCUSDT',
      side: 'BUY',
      price: 50000,
      originalQuantity: 1.0,
      remainingQuantity: 1.0,
      cumulativeExecutedQuantity: 0,
      state: LifecycleState.INTENT_CREATED,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const result = riskGuard.reserveAndSaveIntent(intent);
    expect(result).toBe(true);
    expect(intent.state).toBe(LifecycleState.RISK_RESERVED);

    const exposure = riskGuard.calculateExposure();
    expect(exposure.worstLong).toBe(1.0);
    expect(exposure.worstShort).toBe(0.0);
  });

  it('should reject intents that exceed max exposure', () => {
    riskGuard.syncPosition(1.5); // already long 1.5

    const intent: OrderIntent = {
      clientOrderId: 'test-2',
      exchangeOrderId: null,
      symbol: 'BTCUSDT',
      side: 'BUY',
      price: 50000,
      originalQuantity: 1.0,
      remainingQuantity: 1.0,
      cumulativeExecutedQuantity: 0,
      state: LifecycleState.INTENT_CREATED,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const result = riskGuard.reserveAndSaveIntent(intent);
    expect(result).toBe(false); // 1.5 + 1.0 = 2.5 > 2.0 limit
    
    // Intent should not be saved
    expect(journal.getIntent('test-2')).toBeUndefined();
  });
});
