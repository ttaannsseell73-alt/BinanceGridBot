import Database from 'better-sqlite3';
import { logger } from '../utils/logger';
import { OrderIntent, FillIdentity, LifecycleState } from '../models/types';
import fs from 'fs';
import path from 'path';

export class IntentJournal {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath, {
      // verbose: console.log
    });
    
    this.init();
  }

  private init() {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL'); // WAL mode is safe with NORMAL

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS intents (
        clientOrderId TEXT PRIMARY KEY,
        exchangeOrderId TEXT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        price REAL NOT NULL,
        originalQuantity REAL NOT NULL,
        remainingQuantity REAL NOT NULL,
        cumulativeExecutedQuantity REAL NOT NULL,
        state TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fills (
        id TEXT PRIMARY KEY, -- Composite: symbol|exchangeOrderId|tradeId
        symbol TEXT NOT NULL,
        exchangeOrderId TEXT NOT NULL,
        tradeId TEXT NOT NULL,
        clientOrderId TEXT NOT NULL,
        price REAL NOT NULL,
        quantity REAL NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY(clientOrderId) REFERENCES intents(clientOrderId)
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt INTEGER NOT NULL
      );
    `);

    logger.info('IntentJournal initialized');
  }

  public saveIntent(intent: OrderIntent): void {
    const stmt = this.db.prepare(`
      INSERT INTO intents (
        clientOrderId, exchangeOrderId, symbol, side, price, 
        originalQuantity, remainingQuantity, cumulativeExecutedQuantity, 
        state, createdAt, updatedAt
      ) VALUES (
        @clientOrderId, @exchangeOrderId, @symbol, @side, @price,
        @originalQuantity, @remainingQuantity, @cumulativeExecutedQuantity,
        @state, @createdAt, @updatedAt
      )
    `);
    
    stmt.run(intent);
  }

  public updateIntentState(clientOrderId: string, state: LifecycleState, exchangeOrderId?: string | null): void {
    const now = Date.now();
    if (exchangeOrderId !== undefined) {
      const stmt = this.db.prepare(`
        UPDATE intents 
        SET state = ?, exchangeOrderId = ?, updatedAt = ? 
        WHERE clientOrderId = ?
      `);
      stmt.run(state, exchangeOrderId, now, clientOrderId);
    } else {
      const stmt = this.db.prepare(`
        UPDATE intents 
        SET state = ?, updatedAt = ? 
        WHERE clientOrderId = ?
      `);
      stmt.run(state, now, clientOrderId);
    }
  }

  public updateIntentExecution(
    clientOrderId: string, 
    remainingQuantity: number, 
    cumulativeExecutedQuantity: number, 
    state: LifecycleState
  ): void {
    const stmt = this.db.prepare(`
      UPDATE intents 
      SET remainingQuantity = ?, cumulativeExecutedQuantity = ?, state = ?, updatedAt = ? 
      WHERE clientOrderId = ?
    `);
    stmt.run(remainingQuantity, cumulativeExecutedQuantity, state, Date.now(), clientOrderId);
  }

  public saveFill(fill: FillIdentity): boolean {
    const id = `${fill.symbol}|${fill.exchangeOrderId}|${fill.tradeId}`;
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO fills (
        id, symbol, exchangeOrderId, tradeId, clientOrderId, price, quantity, timestamp
      ) VALUES (
        @id, @symbol, @exchangeOrderId, @tradeId, @clientOrderId, @price, @quantity, @timestamp
      )
    `);

    const result = stmt.run({ ...fill, id });
    return result.changes > 0; // returns false if duplicate ignored
  }

  public getIntent(clientOrderId: string): OrderIntent | undefined {
    const stmt = this.db.prepare(`SELECT * FROM intents WHERE clientOrderId = ?`);
    return stmt.get(clientOrderId) as OrderIntent | undefined;
  }

  public getOpenIntents(): OrderIntent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM intents 
      WHERE state NOT IN ('CONFIRMED_FILLED', 'CONFIRMED_CANCELED', 'CONFIRMED_REJECTED')
    `);
    return stmt.all() as OrderIntent[];
  }

  public getAllIntents(): OrderIntent[] {
    const stmt = this.db.prepare(`SELECT * FROM intents`);
    return stmt.all() as OrderIntent[];
  }

  // Atomically process a fill and update the intent
  public processFill(fill: FillIdentity, remainingQty: number, cumQty: number, newState: LifecycleState): boolean {
    const processTx = this.db.transaction(() => {
      const inserted = this.saveFill(fill);
      if (inserted) {
        const stmt = this.db.prepare('SELECT SUM(quantity) as total FROM fills WHERE clientOrderId = ?');
        const res = stmt.get(fill.clientOrderId) as { total: number };
        const actualCumQty = res.total || 0;
        
        const intent = this.getIntent(fill.clientOrderId);
        if (intent) {
          const actualRemaining = intent.originalQuantity - actualCumQty;
          this.updateIntentExecution(fill.clientOrderId, actualRemaining, actualCumQty, newState);
        }
        return true;
      }
      return false; // Duplicate fill, ignored
    });
    
    return processTx();
  }

  public setSystemState(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO system_state (key, value, updatedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updatedAt = excluded.updatedAt
    `);
    stmt.run(key, value, Date.now());
  }

  public getSystemState(key: string): string | undefined {
    const stmt = this.db.prepare(`SELECT value FROM system_state WHERE key = ?`);
    const row = stmt.get(key) as { value: string } | undefined;
    return row?.value;
  }

  public clearSystemState(key: string): void {
    this.db.prepare(`DELETE FROM system_state WHERE key = ?`).run(key);
  }

  public wipeAllDataForTesting(): void {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot wipe data in production mode');
    }
    this.db.exec(`
      DELETE FROM fills;
      DELETE FROM intents;
      DELETE FROM system_state;
    `);
  }

  public close(): void {
    this.db.close();
  }
}
