import { IBinanceClient, OrderRequest, OrderResponse, SymbolRiskConfig } from '../gateways/IBinanceClient';
import { FakeBinanceExchange, FakeOrder } from '../tests/FakeBinanceExchange';

export class FakeBinanceClient implements IBinanceClient {
  constructor(private exchange: FakeBinanceExchange) {}

  private mapOrder(order: FakeOrder): OrderResponse {
    return {
      clientOrderId: order.clientOrderId,
      orderId: order.orderId,
      symbol: order.symbol,
      status: order.status,
      side: order.side,
      price: order.price,
      origQty: order.origQty,
      executedQty: order.executedQty,
      updateTime: order.updateTime,
    };
  }

  async postOrder(params: OrderRequest): Promise<OrderResponse> {
    const order = this.exchange.placeOrder(params);
    return this.mapOrder(order);
  }

  async cancelOrder(symbol: string, origClientOrderId: string): Promise<OrderResponse> {
    const order = this.exchange.cancelOrder(origClientOrderId);
    return this.mapOrder(order);
  }

  async getOrder(symbol: string, origClientOrderId: string): Promise<OrderResponse | null> {
    const order = this.exchange.getOrder(origClientOrderId);
    return order ? this.mapOrder(order) : null;
  }

  async getOpenOrders(symbol: string): Promise<OrderResponse[]> {
    if (this.exchange.simulateRestTimeout) throw new Error('Timeout');
    if (this.exchange.simulateRest500) throw new Error('HTTP 500 Internal Server Error');

    const openOrders: OrderResponse[] = [];
    for (const [clientId, order] of (this.exchange as any).orders.entries()) {
      if (order.symbol === symbol && (order.status === 'NEW' || order.status === 'PARTIALLY_FILLED')) {
        openOrders.push(this.mapOrder(order));
      }
    }
    return openOrders;
  }

  async getPositionMode(): Promise<'ONE_WAY' | 'HEDGE'> {
    if (this.exchange.simulateRestTimeout) throw new Error('Timeout');
    if (this.exchange.simulateRest500) throw new Error('HTTP 500 Internal Server Error');
    return this.exchange.hedgeMode ? 'HEDGE' : 'ONE_WAY';
  }

  async getPositionAmount(symbol: string): Promise<number> {
    if (this.exchange.simulateRestTimeout) throw new Error('Timeout');
    if (this.exchange.simulateRest500) throw new Error('HTTP 500 Internal Server Error');
    return this.exchange.positionAmount;
  }

  async getSymbolRiskConfig(symbol: string): Promise<SymbolRiskConfig> {
    if (this.exchange.simulateRestTimeout) throw new Error('Timeout');
    if (this.exchange.simulateRest500) throw new Error('HTTP 500 Internal Server Error');
    return {
      symbol,
      marginType: this.exchange.marginType,
      leverage: this.exchange.leverage
    };
  }

  async setMarginType(
    symbol: string,
    marginType: 'ISOLATED' | 'CROSSED'
  ): Promise<void> {
    if (this.exchange.simulateRestTimeout) throw new Error('Timeout');
    if (this.exchange.simulateRest500) throw new Error('HTTP 500 Internal Server Error');
    this.exchange.marginType = marginType;
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    if (this.exchange.simulateRestTimeout) throw new Error('Timeout');
    if (this.exchange.simulateRest500) throw new Error('HTTP 500 Internal Server Error');
    this.exchange.leverage = leverage;
  }

  async getAllOrders(symbol: string, limit: number = 1000): Promise<OrderResponse[]> {
    if (this.exchange.simulateRestTimeout) throw new Error('Timeout');
    if (this.exchange.simulateRest500) throw new Error('HTTP 500 Internal Server Error');

    const orders: OrderResponse[] = [];
    for (const [, order] of (this.exchange as any).orders.entries()) {
      if (order.symbol === symbol) {
        orders.push(this.mapOrder(order));
      }
    }

    orders.sort((a, b) => b.updateTime - a.updateTime);
    return orders.slice(0, Math.max(1, Math.min(1000, Math.floor(limit))));
  }
}
