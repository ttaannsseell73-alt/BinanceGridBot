import { IBinanceClient, OrderRequest, OrderResponse } from './IBinanceClient';
import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../utils/logger';
import { Candle } from '../models/strategy';

export class BinanceRestClient implements IBinanceClient {
  constructor(
    private restUrl: string,
    private apiKey: string,
    private apiSecret: string
  ) {}

  private symbolRules = new Map<string, {
    tickSize: number;
    minPrice: number;
    maxPrice: number;
    stepSize: number;
    minQty: number;
    maxQty: number;
    priceDecimals: number;
    qtyDecimals: number;
  }>();

  private decimalsFromFilter(value: string): number {
    const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
    const dot = trimmed.indexOf('.');
    return dot === -1 ? 0 : trimmed.length - dot - 1;
  }

  private async getSymbolRules(symbol: string) {
    const cached = this.symbolRules.get(symbol);
    if (cached) return cached;

    const response = await axios.get(`${this.restUrl}/fapi/v1/exchangeInfo`);
    const symbolInfo = response.data.symbols?.find((s: any) => s.symbol === symbol);

    if (!symbolInfo) {
      throw new Error(`Binance symbol not found: ${symbol}`);
    }

    const priceFilter = symbolInfo.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');
    const lotFilter =
      symbolInfo.filters?.find((f: any) => f.filterType === 'LOT_SIZE') ??
      symbolInfo.filters?.find((f: any) => f.stepSize !== undefined);

    if (!priceFilter || !lotFilter) {
      throw new Error(`Binance filters missing for ${symbol}`);
    }

    const rules = {
      tickSize: Number(priceFilter.tickSize),
      minPrice: Number(priceFilter.minPrice ?? 0),
      maxPrice: Number(priceFilter.maxPrice ?? 0),
      stepSize: Number(lotFilter.stepSize),
      minQty: Number(lotFilter.minQty ?? 0),
      maxQty: Number(lotFilter.maxQty ?? 0),
      priceDecimals: this.decimalsFromFilter(String(priceFilter.tickSize)),
      qtyDecimals: this.decimalsFromFilter(String(lotFilter.stepSize)),
    };

    if (rules.tickSize <= 0 || rules.stepSize <= 0) {
      throw new Error(`Invalid Binance filters for ${symbol}`);
    }

    this.symbolRules.set(symbol, rules);

    logger.info({ symbol, rules }, 'Loaded Binance symbol filters');
    return rules;
  }

  private async normalizeOrder(req: OrderRequest): Promise<{ price: string; quantity: string }> {
    const r = await this.getSymbolRules(req.symbol);

    if (r.minPrice > 0 && req.price < r.minPrice) {
      throw new Error(`Price below minPrice for ${req.symbol}`);
    }
    if (r.maxPrice > 0 && req.price > r.maxPrice) {
      throw new Error(`Price above maxPrice for ${req.symbol}`);
    }
    if (r.minQty > 0 && req.quantity < r.minQty) {
      throw new Error(`Quantity below minQty for ${req.symbol}`);
    }
    if (r.maxQty > 0 && req.quantity > r.maxQty) {
      throw new Error(`Quantity above maxQty for ${req.symbol}`);
    }

    const priceBase = r.minPrice > 0 ? r.minPrice : 0;
    const rawPriceUnits = (req.price - priceBase) / r.tickSize;

    const priceUnits =
      req.side === 'BUY'
        ? Math.floor(rawPriceUnits + 1e-10)
        : Math.ceil(rawPriceUnits - 1e-10);

    const normalizedPrice = priceBase + priceUnits * r.tickSize;

    const qtyBase = r.minQty > 0 ? r.minQty : 0;
    const rawQtyUnits = (req.quantity - qtyBase) / r.stepSize;
    const qtyUnits = Math.floor(rawQtyUnits + 1e-10);
    const normalizedQty = qtyBase + qtyUnits * r.stepSize;

    if (normalizedQty <= 0) {
      throw new Error(`Normalized quantity is zero for ${req.symbol}`);
    }

    const price = normalizedPrice.toFixed(r.priceDecimals);
    const quantity = normalizedQty.toFixed(r.qtyDecimals);

    logger.debug({
      symbol: req.symbol,
      side: req.side,
      requestedPrice: req.price,
      normalizedPrice: price,
      requestedQuantity: req.quantity,
      normalizedQuantity: quantity
    }, 'Normalized order to Binance filters');

    return { price, quantity };
  }

  private sign(queryString: string): string {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  private async request<T>(method: 'GET' | 'POST' | 'DELETE', endpoint: string, params: Record<string, any>): Promise<T> {
    params.timestamp = Date.now();
    params.recvWindow = 5000;

    const queryString = Object.keys(params)
      .map(key => `${key}=${encodeURIComponent(params[key])}`)
      .join('&');

    const signature = this.sign(queryString);
    const finalUrl = `${this.restUrl}${endpoint}?${queryString}&signature=${signature}`;

    try {
      const response = await axios({
        method,
        url: finalUrl,
        headers: {
          'X-MBX-APIKEY': this.apiKey,
        },
      });
      return response.data;
    } catch (error: any) {
      const msg = error.response?.data?.msg || error.message;
      logger.error({ endpoint, msg }, 'Binance REST API error');
      throw new Error(`Binance API Error: ${msg}`);
    }
  }

  async getRecentKlines(
    symbol: string,
    interval: string = '1m',
    limit: number = 100
  ): Promise<Candle[]> {
    const safeLimit = Math.max(1, Math.min(1500, Math.floor(limit)));

    try {
      const response = await axios.get(`${this.restUrl}/fapi/v1/klines`, {
        params: { symbol, interval, limit: safeLimit }
      });

      const now = Date.now();
      const rows: any[] = Array.isArray(response.data) ? response.data : [];

      return rows
        .filter(k => Array.isArray(k) && Number(k[6]) < now)
        .map(k => ({
          timestamp: Number(k[0]),
          open: Number(k[1]),
          high: Number(k[2]),
          low: Number(k[3]),
          close: Number(k[4]),
          volume: Number(k[5]),
          isClosed: true,
          takerBuyBaseAssetVolume: Number(k[9])
        }))
        .filter(c =>
          Number.isFinite(c.timestamp) &&
          Number.isFinite(c.open) &&
          Number.isFinite(c.high) &&
          Number.isFinite(c.low) &&
          Number.isFinite(c.close) &&
          Number.isFinite(c.volume)
        );
    } catch (error: any) {
      const msg = error.response?.data?.msg || error.message;
      logger.error({ symbol, interval, limit: safeLimit, msg }, 'Binance recent klines request failed');
      throw new Error(`Binance Klines Error: ${msg}`);
    }
  }

  async getOpenInterest(symbol: string): Promise<{ openInterest: number; time: number }> {
    try {
      const response = await axios.get(`${this.restUrl}/fapi/v1/openInterest`, {
        params: { symbol }
      });

      const openInterest = Number(response.data?.openInterest);
      const time = Number(response.data?.time ?? Date.now());

      if (!Number.isFinite(openInterest) || openInterest <= 0) {
        throw new Error(`Invalid open interest for ${symbol}`);
      }

      return { openInterest, time };
    } catch (error: any) {
      const msg = error.response?.data?.msg || error.message;
      logger.error({ symbol, msg }, 'Binance open interest request failed');
      throw new Error(`Binance Open Interest Error: ${msg}`);
    }
  }

  async getPositionMode(): Promise<'ONE_WAY' | 'HEDGE'> {
    const data: any = await this.request(
      'GET',
      '/fapi/v1/positionSide/dual',
      {}
    );

    return data?.dualSidePosition === true ? 'HEDGE' : 'ONE_WAY';
  }

  async getPositionAmount(symbol: string): Promise<number> {
    const data: any = await this.request(
      'GET',
      '/fapi/v3/positionRisk',
      { symbol }
    );

    const rows: any[] = Array.isArray(data) ? data : [data];
    const relevant = rows.filter(row => row?.symbol === symbol);

    if (relevant.length === 0) {
      return 0;
    }

    let netPosition = 0;

    for (const row of relevant) {
      const positionSide = String(row?.positionSide ?? 'BOTH').toUpperCase();
      if (positionSide !== 'BOTH') {
        throw new Error(
          `Unsupported hedge-mode position row for ${symbol}: ${positionSide}`
        );
      }

      const amount = Number(row?.positionAmt);
      if (!Number.isFinite(amount)) {
        throw new Error(`Invalid position amount for ${symbol}`);
      }

      netPosition += amount;
    }

    return Number(netPosition.toFixed(8));
  }

  async postOrder(req: OrderRequest): Promise<OrderResponse> {
    const normalized = await this.normalizeOrder(req);

    const params: Record<string, any> = {
      symbol: req.symbol,
      side: req.side,
      type: req.type,
      quantity: normalized.quantity,
      price: normalized.price,
      timeInForce: req.timeInForce,
      newClientOrderId: req.newClientOrderId,
    };

    const data: any = await this.request('POST', '/fapi/v1/order', params);
    
    return {
      clientOrderId: data.clientOrderId,
      orderId: data.orderId,
      symbol: data.symbol,
      status: data.status,
      side: data.side,
      price: parseFloat(data.price),
      origQty: parseFloat(data.origQty),
      executedQty: parseFloat(data.executedQty),
      updateTime: data.updateTime,
    };
  }

  async cancelOrder(symbol: string, origClientOrderId: string): Promise<OrderResponse> {
    const params = { symbol, origClientOrderId };
    const data: any = await this.request('DELETE', '/fapi/v1/order', params);
    
    return {
      clientOrderId: data.clientOrderId,
      orderId: data.orderId,
      symbol: data.symbol,
      status: data.status,
      side: data.side,
      price: parseFloat(data.price),
      origQty: parseFloat(data.origQty),
      executedQty: parseFloat(data.executedQty),
      updateTime: data.updateTime,
    };
  }

  async getOrder(symbol: string, origClientOrderId: string): Promise<OrderResponse | null> {
    try {
      const params = { symbol, origClientOrderId };
      const data: any = await this.request('GET', '/fapi/v1/order', params);
      
      return {
        clientOrderId: data.clientOrderId,
        orderId: data.orderId,
        symbol: data.symbol,
        status: data.status,
        side: data.side,
        price: parseFloat(data.price),
        origQty: parseFloat(data.origQty),
        executedQty: parseFloat(data.executedQty),
        updateTime: data.updateTime,
      };
    } catch (err: any) {
      if (err.message.includes('-2013') || err.message.includes('Order does not exist')) {
        return null;
      }
      throw err;
    }
  }

  async getOpenOrders(symbol: string): Promise<OrderResponse[]> {
    const data: any[] = await this.request('GET', '/fapi/v1/openOrders', { symbol });
    
    return data.map(d => ({
      clientOrderId: d.clientOrderId,
      orderId: d.orderId,
      symbol: d.symbol,
      status: d.status,
      side: d.side,
      price: parseFloat(d.price),
      origQty: parseFloat(d.origQty),
      executedQty: parseFloat(d.executedQty),
      updateTime: d.updateTime,
    }));
  }

  async getAllOrders(symbol: string, limit: number = 1000): Promise<OrderResponse[]> {
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const data: any[] = await this.request('GET', '/fapi/v1/allOrders', {
      symbol,
      limit: safeLimit
    });

    return data.map(d => ({
      clientOrderId: d.clientOrderId,
      orderId: d.orderId,
      symbol: d.symbol,
      status: d.status,
      side: d.side,
      price: parseFloat(d.price),
      origQty: parseFloat(d.origQty),
      executedQty: parseFloat(d.executedQty),
      updateTime: d.updateTime,
    }));
  }
}

