import { EventEmitter } from 'events';

export type FakeOrderSide = 'BUY' | 'SELL';
export type FakeOrderType = 'LIMIT';
export type FakeTimeInForce = 'GTC' | 'GTX';
export type FakeOrderStatus = 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'REJECTED' | 'EXPIRED';

export interface FakeOrder {
  clientOrderId: string;
  orderId: number;
  symbol: string;
  side: FakeOrderSide;
  price: number;
  origQty: number;
  executedQty: number;
  status: FakeOrderStatus;
  timeInForce: FakeTimeInForce;
  type: FakeOrderType;
  updateTime: number;
}

export class FakeBinanceExchange extends EventEmitter {
  private orders: Map<string, FakeOrder> = new Map();
  private nextOrderId = 1;
  private currentPrice = 50000;
  
  // Failure simulation flags
  public simulateRestTimeout = false;
  public simulateRest500 = false;
  public simulateWsDisconnect = false;
  public dropNextRestResponse = false;
  
  public getOrder(origClientOrderId: string): FakeOrder | undefined {
    // If drop flag is true, but client asks for REST, we still return if the connection is fine
    // However, if simulateRest500 is true, we would throw
    if (this.simulateRestTimeout) throw new Error('Timeout');
    if (this.simulateRest500) throw new Error('HTTP 500 Internal Server Error');
    return this.orders.get(origClientOrderId);
  }

  public placeOrder(params: {
    symbol: string;
    side: FakeOrderSide;
    type: FakeOrderType;
    quantity: number;
    price: number;
    timeInForce: FakeTimeInForce;
    newClientOrderId: string;
  }): FakeOrder {
    if (this.simulateRestTimeout) throw new Error('Timeout');
    if (this.simulateRest500) throw new Error('HTTP 500 Internal Server Error');

    const orderId = this.nextOrderId++;
    const now = Date.now();

    const order: FakeOrder = {
      clientOrderId: params.newClientOrderId,
      orderId,
      symbol: params.symbol,
      side: params.side,
      price: params.price,
      origQty: params.quantity,
      executedQty: 0,
      status: 'NEW',
      timeInForce: params.timeInForce,
      type: params.type,
      updateTime: now,
    };

    // GTX Check
    if (params.timeInForce === 'GTX') {
      if ((params.side === 'BUY' && params.price >= this.currentPrice) ||
          (params.side === 'SELL' && params.price <= this.currentPrice)) {
        order.status = 'EXPIRED'; // Post-only reject
      }
    }

    this.orders.set(order.clientOrderId, order);

    if (!this.dropNextRestResponse) {
      // Normal ACK return
      // We will also emit WS update shortly
      this.emitWsUpdate(order);
      return order;
    } else {
      this.dropNextRestResponse = false; // Reset
      // Emit WS update, but the REST caller gets an error or timeout
      this.emitWsUpdate(order);
      throw new Error('Network Error: Response dropped');
    }
  }

  public cancelOrder(origClientOrderId: string): FakeOrder {
    if (this.simulateRestTimeout) throw new Error('Timeout');
    if (this.simulateRest500) throw new Error('HTTP 500 Internal Server Error');

    const order = this.orders.get(origClientOrderId);
    if (!order) throw new Error('Unknown order');

    if (order.status !== 'NEW' && order.status !== 'PARTIALLY_FILLED') {
      throw new Error('Order cannot be canceled');
    }

    order.status = 'CANCELED';
    order.updateTime = Date.now();
    this.emitWsUpdate(order);

    return order;
  }

  public simulateFill(origClientOrderId: string, fillQty: number, tradeId?: string) {
    const order = this.orders.get(origClientOrderId);
    if (!order) return;

    if (order.status === 'CANCELED' || order.status === 'FILLED' || order.status === 'REJECTED') {
      return;
    }

    order.executedQty += fillQty;
    order.updateTime = Date.now();
    
    // Fix floating point
    order.executedQty = Number(order.executedQty.toFixed(8));

    if (order.executedQty >= order.origQty) {
      order.status = 'FILLED';
    } else {
      order.status = 'PARTIALLY_FILLED';
    }

    this.emitWsTradeUpdate(order, fillQty, tradeId || String(Date.now()));
  }

  public emitWsUpdate(order: FakeOrder) {
    if (this.simulateWsDisconnect) return;

    // Simulate Binance ORDER_TRADE_UPDATE payload
    const payload = {
      e: 'ORDER_TRADE_UPDATE',
      E: Date.now(),
      T: Date.now(),
      o: {
        s: order.symbol,
        c: order.clientOrderId,
        S: order.side,
        o: order.type,
        f: order.timeInForce,
        q: order.origQty.toString(),
        p: order.price.toString(),
        X: order.status,
        i: order.orderId,
        z: order.executedQty.toString(),
        l: '0', // last filled qty
        n: '0', // commission
        N: 'USDT', // commission asset
        t: 0, // trade id
      }
    };

    // Use setImmediate to simulate network delay for WS
    setImmediate(() => {
      this.emit('message', JSON.stringify(payload));
    });
  }

  public emitWsTradeUpdate(order: FakeOrder, lastFillQty: number, tradeId: string) {
    if (this.simulateWsDisconnect) return;

    const payload = {
      e: 'ORDER_TRADE_UPDATE',
      E: Date.now(),
      T: Date.now(),
      o: {
        s: order.symbol,
        c: order.clientOrderId,
        S: order.side,
        o: order.type,
        f: order.timeInForce,
        q: order.origQty.toString(),
        p: order.price.toString(),
        X: order.status,
        i: order.orderId,
        z: order.executedQty.toString(),
        l: lastFillQty.toString(),
        n: '0', 
        N: 'USDT',
        t: parseInt(tradeId, 10) || Date.now(),
      }
    };

    setImmediate(() => {
      this.emit('message', JSON.stringify(payload));
    });
  }

  // Set market price
  public setPrice(price: number) {
    this.currentPrice = price;
  }

  // --- Historical Simulation Methods ---
  
  public getActiveOrders(): FakeOrder[] {
    return Array.from(this.orders.values()).filter(o => o.status === 'NEW' || o.status === 'PARTIALLY_FILLED');
  }

  /**
   * Simulates fills based on candle data conservatively.
   */
  public simulateCandle(
    candle: { timestamp: number; open: number; high: number; low: number; close: number; volume: number },
    slippageBps: number = 0,
    feeBps: number = 0
  ) {
    this.currentPrice = candle.close;
    const activeOrders = this.getActiveOrders();
    
    for (const order of activeOrders) {
      if (order.type !== 'LIMIT') continue;

      let isFilled = false;
      let isPartial = false;

      // Maker-First Fill Model:
      // Since queue position is unknown, limit orders require deeper penetration to guarantee fill.
      // - Deep Penetration (> 10 bps): Full fill (isFilled = true)
      // - Moderate Penetration (> 5 bps): Partial fill (25%)
      // - Marginal/Touch (< 5 bps): No fill (queue uncertainty / latency)
      
      const DEEP_PENETRATION_BPS = 0.0010; // 10 bps
      const MODERATE_PENETRATION_BPS = 0.0005; // 5 bps

      if (order.side === 'BUY') {
        const deepLevel = order.price * (1 - DEEP_PENETRATION_BPS);
        const modLevel = order.price * (1 - MODERATE_PENETRATION_BPS);
        
        if (candle.low < deepLevel) {
           isFilled = true;
        } else if (candle.low < modLevel) {
           isPartial = true;
        }
      } else if (order.side === 'SELL') {
        const deepLevel = order.price * (1 + DEEP_PENETRATION_BPS);
        const modLevel = order.price * (1 + MODERATE_PENETRATION_BPS);
        
        if (candle.high > deepLevel) {
           isFilled = true;
        } else if (candle.high > modLevel) {
           isPartial = true;
        }
      }

      // TimeInForce handling
      if (order.timeInForce === 'GTX') {
         // In historical simulation with candles, GTX is tricky. We assume if it survived the placement tick, it's resting.
      }

      if (isFilled || isPartial) {
        // Calculate fill quantity
        const remainingQty = order.origQty - order.executedQty;
        // Partial fill modeled conservatively as 25% of remaining quantity per candle
        const fillQty = isPartial ? remainingQty * 0.25 : remainingQty;
        
        // Slippage: in simulation, limit orders usually don't have price slippage, but we might simulate spread or execution delay.
        // We will just execute at the limit price for maker, but apply fees.
        const execPrice = order.price; 
        
        // Fee deduction is handled by MetricsEngine using the order updates. We will pass commission in payload.
        const feeAmount = (execPrice * fillQty) * (feeBps / 10000);

        this.simulateFillWithFee(order.clientOrderId, fillQty, execPrice, feeAmount, String(candle.timestamp));
      }
    }
  }

  private simulateFillWithFee(origClientOrderId: string, fillQty: number, execPrice: number, fee: number, tradeId: string) {
    const order = this.orders.get(origClientOrderId);
    if (!order) return;

    if (order.status === 'CANCELED' || order.status === 'FILLED' || order.status === 'REJECTED') {
      return;
    }

    order.executedQty += fillQty;
    order.updateTime = Date.now();
    
    // Fix floating point
    order.executedQty = Number(order.executedQty.toFixed(8));

    if (order.executedQty >= order.origQty * 0.999) { // close enough
      order.status = 'FILLED';
      order.executedQty = order.origQty;
    } else {
      order.status = 'PARTIALLY_FILLED';
    }

    // Emit WS with fee
    if (this.simulateWsDisconnect) return;

    const payload = {
      e: 'ORDER_TRADE_UPDATE',
      E: Date.now(),
      T: Date.now(),
      o: {
        s: order.symbol,
        c: order.clientOrderId,
        S: order.side,
        o: order.type,
        f: order.timeInForce,
        q: order.origQty.toString(),
        p: order.price.toString(),
        X: order.status,
        i: order.orderId,
        z: order.executedQty.toString(),
        l: fillQty.toString(),
        L: execPrice.toString(), // Last fill price
        n: fee.toString(), 
        N: 'USDT',
        t: parseInt(tradeId, 10) || Date.now(),
      }
    };

    setImmediate(() => {
      this.emit('message', JSON.stringify(payload));
    });
  }
}
