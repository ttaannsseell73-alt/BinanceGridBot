import { IBinanceClient } from '../gateways/IBinanceClient';
import { RiskGuard } from './RiskGuard';

export async function syncStartupRiskState(
  client: IBinanceClient,
  riskGuard: RiskGuard,
  symbol: string
): Promise<number> {
  const mode = await client.getPositionMode();

  if (mode !== 'ONE_WAY') {
    throw new Error(
      'Unsupported Binance Hedge Mode. Grid bot requires ONE_WAY position mode.'
    );
  }

  const positionAmount = await client.getPositionAmount(symbol);

  if (!Number.isFinite(positionAmount)) {
    throw new Error(`Invalid startup position amount for ${symbol}`);
  }

  riskGuard.syncPosition(positionAmount);
  return positionAmount;
}
