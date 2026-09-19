import { FakeOrderSide, FakeOrderType, FakeTimeInForce, FakeOrderStatus } from '../tests/FakeBinanceExchange';

export interface OrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT';
  timeInForce: 'GTC' | 'GTX';
  quantity: number;
  price: number;
  newClientOrderId: string;
}

export interface SymbolRiskConfig {
  symbol: string;
  marginType: 'ISOLATED' | 'CROSSED';
  leverage: number;
}

export interface OrderResponse {
  clientOrderId: string;
  orderId: number;
  symbol: string;
  status: string; // NEW, EXPIRED, REJECTED, PARTIALLY_FILLED, FILLED, CANCELED
  side: string;
  price: number;
  origQty: number;
  executedQty: number;
  updateTime: number;
}

export interface IBinanceClient {
  postOrder(params: OrderRequest): Promise<OrderResponse>;
  cancelOrder(symbol: string, origClientOrderId: string): Promise<OrderResponse>;
  getOrder(symbol: string, origClientOrderId: string): Promise<OrderResponse | null>;
  getOpenOrders(symbol: string): Promise<OrderResponse[]>;
  getAllOrders(symbol: string, limit?: number): Promise<OrderResponse[]>;
  getPositionMode(): Promise<'ONE_WAY' | 'HEDGE'>;
  getPositionAmount(symbol: string): Promise<number>;
  getSymbolRiskConfig(symbol: string): Promise<SymbolRiskConfig>;
  setMarginType(symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<void>;
  setLeverage(symbol: string, leverage: number): Promise<void>;
}
