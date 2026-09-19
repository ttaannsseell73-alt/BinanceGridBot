import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { Candle, Tick } from '../models/strategy';

export interface IMarketGateway extends EventEmitter {
  connect(): void;
  disconnect(): void;
  getCurrentPrice(): number;
}

export class BinanceMarketGateway extends EventEmitter implements IMarketGateway {
  private ws: WebSocket | null = null;
  private currentPrice = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private intentionalDisconnect = false;

  constructor(
    private wsUrl: string,
    private symbol: string
  ) {
    super();
  }

  public connect(): void {
    this.intentionalDisconnect = false;

    const s = this.symbol.toLowerCase();

    const streams = [
      `${s}@bookTicker`,
      `${s}@kline_1m`,
      `${s}@aggTrade`
    ].join('/');

    const url = `${this.wsUrl}/stream?streams=${streams}`;

    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      logger.info(
        { streams: ['bookTicker', 'kline_1m', 'aggTrade'] },
        'MarketGateway connected'
      );
    });

    this.ws.on('message', (raw: WebSocket.Data) => {
      try {
        const message = JSON.parse(raw.toString());

        // Combined Binance stream:
        // { stream: "...", data: { ...actual payload... } }
        const payload = message.data ?? message;

        this.handlePayload(payload);
      } catch (err) {
        logger.error(
          { err },
          'MarketGateway message parse error'
        );
      }
    });

    this.ws.on('error', (err) => {
      logger.error(
        { err },
        'MarketGateway error'
      );
    });

    this.ws.on('close', () => {
      this.ws = null;

      if (this.intentionalDisconnect) {
        logger.info('MarketGateway closed');
        return;
      }

      logger.warn(
        'MarketGateway closed. Reconnecting...'
      );

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
      }

      this.reconnectTimer = setTimeout(
        () => this.connect(),
        5000
      );
    });
  }

  private handlePayload(payload: any): void {
    /*
     * BOOK TICKER
     */
    if (
      payload.e === 'bookTicker' ||
      (payload.b !== undefined && payload.a !== undefined)
    ) {
      const bid = Number(payload.b);
      const ask = Number(payload.a);

      if (
        Number.isFinite(bid) &&
        Number.isFinite(ask) &&
        bid > 0 &&
        ask > 0
      ) {
        this.currentPrice = (bid + ask) / 2;

        this.emit(
          'price_update',
          this.currentPrice
        );
      }

      return;
    }

    /*
     * AGGREGATE TRADE
     *
     * m=true:
     * buyer is maker -> aggressive side was SELL
     *
     * Tick model already uses Binance's m flag directly
     * as isBuyerMaker.
     */
    if (payload.e === 'aggTrade') {
      const tick: Tick = {
        timestamp:
          Number(payload.T ?? payload.E ?? Date.now()),
        price: Number(payload.p),
        quantity: Number(payload.q),
        isBuyerMaker: Boolean(payload.m)
      };

      if (
        Number.isFinite(tick.price) &&
        Number.isFinite(tick.quantity) &&
        tick.price > 0 &&
        tick.quantity > 0
      ) {
        this.emit('agg_trade', tick);
      }

      return;
    }

    /*
     * 1 MINUTE KLINE
     *
     * PA must only consume CLOSED candles.
     */
    if (
      payload.e === 'kline' &&
      payload.k
    ) {
      const k = payload.k;

      const candle: Candle = {
        timestamp: Number(k.t),
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close: Number(k.c),
        volume: Number(k.v),
        isClosed: Boolean(k.x),
        takerBuyBaseAssetVolume:
          k.V !== undefined
            ? Number(k.V)
            : undefined
      };

      if (
        candle.isClosed &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close) &&
        candle.open > 0 &&
        candle.high > 0 &&
        candle.low > 0 &&
        candle.close > 0
      ) {
        this.emit('kline_close', candle);
      }
    }
  }

  public disconnect(): void {
    this.intentionalDisconnect = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  public getCurrentPrice(): number {
    return this.currentPrice;
  }
}
