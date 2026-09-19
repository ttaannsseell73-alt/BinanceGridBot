import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IntentJournal } from './IntentJournal';
import { LifecycleState, OrderIntent, FillIdentity } from '../models/types';
import fs from 'fs';
import path from 'path';

describe('IntentJournal', () => {
  const dbPath = path.join(__dirname, '../../data/test-journal.db');
  let journal: IntentJournal;

  beforeEach(() => {
    journal = new IntentJournal(dbPath);
    journal.wipeAllDataForTesting();
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

  it('should save and retrieve an intent', () => {
    const intent: OrderIntent = {
      clientOrderId: 'test-123',
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

    journal.saveIntent(intent);
    
    const retrieved = journal.getIntent('test-123');
    expect(retrieved).toBeDefined();
    expect(retrieved?.clientOrderId).toBe('test-123');
    expect(retrieved?.symbol).toBe('BTCUSDT');
  });

  it('should persist and clear system state', () => {
    journal.setSystemState('EMERGENCY_HALTED', '1');
    journal.setSystemState('EMERGENCY_REASON', 'ADVERSE_PRICE_MOVE');

    expect(journal.getSystemState('EMERGENCY_HALTED')).toBe('1');
    expect(journal.getSystemState('EMERGENCY_REASON')).toBe('ADVERSE_PRICE_MOVE');

    journal.clearSystemState('EMERGENCY_HALTED');
    expect(journal.getSystemState('EMERGENCY_HALTED')).toBeUndefined();
  });

  it('should process unique fills and reject duplicates', () => {
    const intent: OrderIntent = {
      clientOrderId: 'order-1',
      exchangeOrderId: 'exch-1',
      symbol: 'BTCUSDT',
      side: 'BUY',
      price: 50000,
      originalQuantity: 1.0,
      remainingQuantity: 1.0,
      cumulativeExecutedQuantity: 0,
      state: LifecycleState.ACKNOWLEDGED,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    journal.saveIntent(intent);

    const fill: FillIdentity = {
      symbol: 'BTCUSDT',
      exchangeOrderId: 'exch-1',
      tradeId: 'trade-1',
      clientOrderId: 'order-1',
      price: 50000,
      quantity: 0.5,
      timestamp: Date.now()
    };

    const firstResult = journal.processFill(fill, 0.5, 0.5, LifecycleState.PARTIALLY_FILLED);
    expect(firstResult).toBe(true);

    const retrieved = journal.getIntent('order-1')!;
    expect(retrieved.cumulativeExecutedQuantity).toBe(0.5);
    expect(retrieved.state).toBe(LifecycleState.PARTIALLY_FILLED);

    // Duplicate fill
    const secondResult = journal.processFill(fill, 0.5, 0.5, LifecycleState.PARTIALLY_FILLED);
    expect(secondResult).toBe(false); // Rejected

    const retrievedAfterDup = journal.getIntent('order-1')!;
    // values shouldn't change
    expect(retrievedAfterDup.cumulativeExecutedQuantity).toBe(0.5);
  });
});
