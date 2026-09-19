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
