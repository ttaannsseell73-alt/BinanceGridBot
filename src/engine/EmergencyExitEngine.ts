import { IBinanceClient } from '../gateways/IBinanceClient';

export interface EmergencyExitResult {
  canceledAllOrders: boolean;
  closedPositionAmount: number;
}

export async function executeEmergencyExit(
  client: IBinanceClient,
  symbol: string
): Promise<EmergencyExitResult> {
  let cancelError: unknown = null;

  try {
    await client.cancelAllOpenOrders(symbol);
  } catch (err) {
    cancelError = err;
  }

  const before = await client.getPositionRisk(symbol);
  let closedPositionAmount = 0;

  if (Math.abs(before.positionAmt) >= 1e-12) {
    closedPositionAmount = before.positionAmt;
    await client.closePositionMarket(symbol, before.positionAmt);
  }

  const after = await client.getPositionRisk(symbol);

  if (Math.abs(after.positionAmt) >= 1e-12) {
    throw new Error(
      `Emergency close verification failed for ${symbol}: positionAmt=${after.positionAmt}`
    );
  }

  if (cancelError) {
    throw cancelError;
  }

  return {
    canceledAllOrders: true,
    closedPositionAmount
  };
}
