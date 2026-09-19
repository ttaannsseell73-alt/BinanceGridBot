import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { logger } from '../utils/logger';

export class Watchdog extends EventEmitter {
  private lastMarketUpdate: number = Date.now();
  private lastUserUpdate: number = Date.now();
  private interval: NodeJS.Timeout | null = null;
  private maxAgeMs = 15000; // 15 seconds

  constructor() {
    super();
  }

  public pingMarket() {
    this.lastMarketUpdate = Date.now();
  }

  public pingUser() {
    this.lastUserUpdate = Date.now();
  }

  public start() {
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => this.checkHealth(), 5000);
    logger.info('Watchdog started');
  }

  public stop() {
    if (this.interval) clearInterval(this.interval);
  }

  private checkHealth() {
    const now = Date.now();
    const marketAge = now - this.lastMarketUpdate;
    const userAge = now - this.lastUserUpdate;

    if (marketAge > this.maxAgeMs) {
      logger.error({ marketAge }, 'Watchdog triggered: Market stream is stale');
      this.emit('stale_market');
    }

  }
}

