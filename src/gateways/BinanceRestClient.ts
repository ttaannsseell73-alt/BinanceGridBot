import { IBinanceClient, OrderRequest, OrderResponse, PositionRiskSnapshot, SymbolRiskConfig } from './IBinanceClient';
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

  // Binance request-weight protection. Automatic retries are GET-only to avoid
  // duplicate trading actions on order/cancel endpoints.
  private restBlockedUntil = 0;
  private lastUsedWeight1m: number | null = null;
  private readonly requestWeightSoftLimit1m = 5400;
  private readonly maxSafeGetRetries = 2;

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private headerNumber(headers: any, name: string): number | null {
    const raw =
      headers?.get?.(name) ??
      headers?.[name] ??
      headers?.[name.toLowerCase()] ??
      headers?.[name.toUpperCase()];
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  private updateRateLimitState(headers: any): void {
    const usedWeight1m = this.headerNumber(headers, 'x-mbx-used-weight-1m');
    if (usedWeight1m === null) return;

    this.lastUsedWeight1m = usedWeight1m;
    if (usedWeight1m >= this.requestWeightSoftLimit1m) {
      logger.warn({ usedWeight1m }, 'Binance REST request weight approaching IP limit');
    } else {
      logger.debug({ usedWeight1m }, 'Binance REST request weight updated');
    }
  }

  private getRetryAfterMs(error: any, attempt: number): number {
    const retryAfterSeconds = this.headerNumber(error?.response?.headers, 'retry-after');
    if (retryAfterSeconds !== null && retryAfterSeconds > 0) {
      return Math.ceil(retryAfterSeconds * 1000);
    }
    return Math.min(60_000, 2_000 * (2 ** attempt));
  }

  private async waitForRestWindow(): Promise<void> {
    const waitMs = this.restBlockedUntil - Date.now();
    if (waitMs <= 0) return;
    logger.warn({ waitMs }, 'Binance REST backoff active; delaying request');
    await this.sleep(waitMs);
  }

  private async publicGet<T>(endpoint: string, params: Record<string, any>): Promise<T> {
    const maxAttempts = this.maxSafeGetRetries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await this.waitForRestWindow();
      try {
        const response = await axios.get(`${this.restUrl}${endpoint}`, { params });
        this.updateRateLimitState(response.headers);
        return response.data;
      } catch (error: any) {
        this.updateRateLimitState(error?.response?.headers);
        const status = Number(error?.response?.status);
        const msg = error?.response?.data?.msg || error.message;

        if ((status === 429 || status === 418) && attempt < maxAttempts - 1) {
          const waitMs = this.getRetryAfterMs(error, attempt);
          this.restBlockedUntil = Math.max(this.restBlockedUntil, Date.now() + waitMs);
          logger.warn({ endpoint, status, waitMs, msg }, 'Binance public REST throttled; backing off');
          continue;
        }

        throw error;
      }
    }

    throw new Error(`Binance public GET exhausted safe retries for ${endpoint}`);
  }

  private decimalsFromFilter(value: string): number {
    const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
    const dot = trimmed.indexOf('.');
    return dot === -1 ? 0 : trimmed.length - dot - 1;
  }

  private async getSymbolRules(symbol: string) {
    const cached = this.symbolRules.get(symbol);
    if (cached) return cached;

    const data: any = await this.publicGet('/fapi/v1/exchangeInfo', {});
    const symbolInfo = data.symbols?.find((s: any) => s.symbol === symbol);

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
    const maxAttempts = method === 'GET' ? this.maxSafeGetRetries + 1 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await this.waitForRestWindow();

      const requestParams: Record<string, any> = { ...params, timestamp: Date.now(), recvWindow: 5000 };
      const queryString = Object.keys(requestParams)
        .map(key => `${key}=${encodeURIComponent(requestParams[key])}`)
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
        this.updateRateLimitState(response.headers);
        return response.data;
      } catch (error: any) {
        this.updateRateLimitState(error?.response?.headers);

        const status = Number(error?.response?.status);
        const msg = error.response?.data?.msg || error.message;

        if (
          method === 'GET' &&
          (status === 429 || status === 418) &&
          attempt < maxAttempts - 1
        ) {
          const waitMs = this.getRetryAfterMs(error, attempt);
          this.restBlockedUntil = Math.max(this.restBlockedUntil, Date.now() + waitMs);
          logger.warn(
            { endpoint, method, status, waitMs, usedWeight1m: this.lastUsedWeight1m, msg },
            'Binance signed REST throttled; backing off'
          );
          continue;
        }

        logger.error(
          { endpoint, method, status, usedWeight1m: this.lastUsedWeight1m, msg },
          'Binance REST API error'
        );
        throw new Error(`Binance API Error: ${msg}`);
      }
    }

    throw new Error(`Binance API Error: exhausted safe GET retries for ${endpoint}`);
  }

  async getRecentKlines(
    symbol: string,
    interval: string = '1m',
    limit: number = 100
  ): Promise<Candle[]> {
    const safeLimit = Math.max(1, Math.min(1500, Math.floor(limit)));

    try {
      const data: any = await this.publicGet('/fapi/v1/klines', {
        symbol,
        interval,
        limit: safeLimit
      });

      const now = Date.now();
      const rows: any[] = Array.isArray(data) ? data : [];

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
      const data: any = await this.publicGet('/fapi/v1/openInterest', { symbol });

      const openInterest = Number(data?.openInterest);
      const time = Number(data?.time ?? Date.now());

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

  async setPositionMode(mode: 'ONE_WAY' | 'HEDGE'): Promise<void> {
    await this.request(
      'POST',
      '/fapi/v1/positionSide/dual',
      { dualSidePosition: mode === 'HEDGE' ? 'true' : 'false' }
    );
  }

  async getPositionAmount(symbol: string): Promise<number> {
    return (await this.getPositionRisk(symbol)).positionAmt;
  }

  async getPositionRisk(symbol: string): Promise<PositionRiskSnapshot> {
    const data: any = await this.request(
      'GET',
      '/fapi/v3/positionRisk',
      { symbol }
    );

    const rows: any[] = Array.isArray(data) ? data : [data];
    const relevant = rows.filter(row => row?.symbol === symbol);

    if (relevant.length === 0) {
      return {
        symbol,
        positionAmt: 0,
        entryPrice: 0,
        markPrice: 0,
        liquidationPrice: 0
      };
    }

    if (relevant.length !== 1) {
      throw new Error(
        `Unexpected position row count for ${symbol}: ${relevant.length}`
      );
    }

    const row = relevant[0];
    const positionSide = String(row?.positionSide ?? 'BOTH').toUpperCase();
    if (positionSide !== 'BOTH') {
      throw new Error(
        `Unsupported hedge-mode position row for ${symbol}: ${positionSide}`
      );
    }

    const snapshot: PositionRiskSnapshot = {
      symbol,
      positionAmt: Number(row?.positionAmt),
      entryPrice: Number(row?.entryPrice),
      markPrice: Number(row?.markPrice),
      liquidationPrice: Number(row?.liquidationPrice)
    };

    if (
      !Number.isFinite(snapshot.positionAmt) ||
      !Number.isFinite(snapshot.entryPrice) ||
      !Number.isFinite(snapshot.markPrice) ||
      !Number.isFinite(snapshot.liquidationPrice)
    ) {
      throw new Error(`Invalid position risk snapshot for ${symbol}`);
    }

    return {
      ...snapshot,
      positionAmt: Number(snapshot.positionAmt.toFixed(8))
    };
  }

  async getSymbolRiskConfig(symbol: string): Promise<SymbolRiskConfig> {
    const data: any = await this.request(
      'GET',
      '/fapi/v1/symbolConfig',
      { symbol }
    );

    const rows: any[] = Array.isArray(data) ? data : [data];
    const row = rows.find(item => item?.symbol === symbol);

    if (!row) {
      throw new Error(`Binance symbol risk config missing for ${symbol}`);
    }

    const rawMarginType = String(row.marginType ?? '').toUpperCase();
    if (rawMarginType !== 'ISOLATED' && rawMarginType !== 'CROSSED') {
      throw new Error(`Invalid margin type for ${symbol}: ${rawMarginType}`);
    }

    const leverage = Number(row.leverage);
    if (!Number.isInteger(leverage) || leverage < 1) {
      throw new Error(`Invalid leverage for ${symbol}: ${row.leverage}`);
    }

    return {
      symbol,
      marginType: rawMarginType,
      leverage
    };
  }

  async setMarginType(
    symbol: string,
    marginType: 'ISOLATED' | 'CROSSED'
  ): Promise<void> {
    await this.request(
      'POST',
      '/fapi/v1/marginType',
      { symbol, marginType }
    );
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    if (!Number.isInteger(leverage) || leverage < 1 || leverage > 125) {
      throw new Error(`Invalid requested leverage: ${leverage}`);
    }

    await this.request(
      'POST',
      '/fapi/v1/leverage',
      { symbol, leverage }
    );
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

  async cancelAllOpenOrders(symbol: string): Promise<void> {
    await this.request('DELETE', '/fapi/v1/allOpenOrders', { symbol });
  }

  async closePositionMarket(symbol: string, positionAmount: number): Promise<void> {
    if (!Number.isFinite(positionAmount)) {
      throw new Error(`Invalid position amount for emergency close: ${positionAmount}`);
    }

    if (Math.abs(positionAmount) < 1e-12) {
      return;
    }

    const rules = await this.getSymbolRules(symbol);
    const rawQtyUnits = Math.abs(positionAmount) / rules.stepSize;
    const qtyUnits = Math.floor(rawQtyUnits + 1e-10);
    const normalizedQty = qtyUnits * rules.stepSize;

    if (normalizedQty <= 0) {
      throw new Error(`Emergency close quantity normalized to zero for ${symbol}`);
    }

    const quantity = normalizedQty.toFixed(rules.qtyDecimals);
    const side = positionAmount > 0 ? 'SELL' : 'BUY';

    await this.request('POST', '/fapi/v1/order', {
      symbol,
      side,
      type: 'MARKET',
      quantity,
      reduceOnly: 'true',
      newClientOrderId: `emergency-${Date.now()}`
    });
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

