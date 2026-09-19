export enum LifecycleState {
  INTENT_CREATED = 'INTENT_CREATED',
  RISK_RESERVED = 'RISK_RESERVED',
  SUBMITTING = 'SUBMITTING',
  SUBMIT_UNKNOWN = 'SUBMIT_UNKNOWN',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  CONFIRMED_FILLED = 'CONFIRMED_FILLED',
  CONFIRMED_CANCELED = 'CONFIRMED_CANCELED',
  CONFIRMED_REJECTED = 'CONFIRMED_REJECTED',
  UNKNOWN = 'UNKNOWN',
}

export type OrderSide = 'BUY' | 'SELL';

export interface OrderIntent {
  clientOrderId: string;
  exchangeOrderId: string | null;
  symbol: string;
  side: OrderSide;
  price: number;
  originalQuantity: number;
  remainingQuantity: number;
  cumulativeExecutedQuantity: number;
  state: LifecycleState;
  createdAt: number;
  updatedAt: number;
}

export interface FillIdentity {
  symbol: string;
  exchangeOrderId: string;
  tradeId: string;
  clientOrderId: string;
  price: number;
  quantity: number;
  timestamp: number;
}

// Risk tracking types
export interface PositionExposure {
  worstLong: number;
  worstShort: number;
}
