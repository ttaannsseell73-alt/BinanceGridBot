export function extractOneWayPositionAmount(
  payload: any,
  symbol: string
): number | null {
  if (payload?.e !== 'ACCOUNT_UPDATE') return null;

  const positions: any[] = Array.isArray(payload?.a?.P)
    ? payload.a.P
    : [];

  const row = positions.find(position =>
    position?.s === symbol &&
    String(position?.ps ?? 'BOTH').toUpperCase() === 'BOTH'
  );

  if (!row) return null;

  const amount = Number(row.pa);
  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid ACCOUNT_UPDATE position amount for ${symbol}`);
  }

  return Number(amount.toFixed(8));
}

export function getUserEventTime(payload: any): number {
  const value = Number(payload?.T ?? payload?.E);
  return Number.isFinite(value) && value > 0 ? value : Date.now();
}

export function isTradeFillUpdate(payload: any): boolean {
  if (payload?.e !== 'ORDER_TRADE_UPDATE') return false;

  const lastFilledQty = Number(payload?.o?.l);
  const tradeId = String(payload?.o?.t ?? '0');

  return Number.isFinite(lastFilledQty) &&
    lastFilledQty > 0 &&
    tradeId !== '' &&
    tradeId !== '0' &&
    tradeId !== '-1';
}
