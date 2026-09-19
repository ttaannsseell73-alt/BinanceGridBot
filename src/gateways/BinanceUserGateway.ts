import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import axios from 'axios';

export interface IUserGateway extends EventEmitter {
  connect(): Promise<void>;
  disconnect(): void;
}

export class BinanceUserGateway extends EventEmitter implements IUserGateway {
  private ws: WebSocket | null = null;
  private listenKey: string = '';
  private keepAliveInterval: NodeJS.Timeout | null = null;

  constructor(
    private restUrl: string,
    private wsUrl: string,
    private apiKey: string
  ) {
    super();
  }

  public async connect() {
    try {
      this.listenKey = await this.getListenKey();
      const url = `${this.wsUrl}/ws/${this.listenKey}`;
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        logger.info('UserGateway connected');
        this.startKeepAlive();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const payload = JSON.parse(data.toString());
          if (payload.e === 'ORDER_TRADE_UPDATE') {
            this.emit('order_trade_update', payload);
          } else if (payload.e === 'listenKeyExpired') {
            logger.warn('listenKey expired, reconnecting UserGateway...');
            this.reconnect();
          }
        } catch (err) {
          logger.error({ err }, 'UserGateway message parse error');
        }
      });

      this.ws.on('error', (err) => {
        logger.error({ err }, 'UserGateway error');
      });

      this.ws.on('close', () => {
        logger.warn('UserGateway closed. Reconnecting...');
        this.reconnect();
      });

    } catch (error: any) {
      logger.error({ err: error }, 'Failed to connect UserGateway');
      setTimeout(() => this.connect(), 5000);
    }
  }

  public disconnect() {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  private reconnect() {
    this.disconnect();
    setTimeout(() => this.connect(), 5000);
  }

  private async getListenKey(): Promise<string> {
    const res = await axios.post(`${this.restUrl}/fapi/v1/listenKey`, null, {
      headers: { 'X-MBX-APIKEY': this.apiKey }
    });
    return res.data.listenKey;
  }

  private startKeepAlive() {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    this.keepAliveInterval = setInterval(async () => {
      try {
        await axios.put(`${this.restUrl}/fapi/v1/listenKey`, null, {
          headers: { 'X-MBX-APIKEY': this.apiKey }
        });
      } catch (err) {
        logger.error({ err }, 'Failed to keepAlive listenKey');
      }
    }, 1000 * 60 * 30); // 30 minutes
  }
}
