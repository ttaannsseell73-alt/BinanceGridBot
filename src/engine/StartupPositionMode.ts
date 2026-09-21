import { IBinanceClient } from '../gateways/IBinanceClient';

export async function ensureStartupPositionMode(
  client: IBinanceClient,
  allowTestnetAutoFix: boolean
): Promise<'ONE_WAY'> {
  const mode = await client.getPositionMode();

  if (mode === 'ONE_WAY') {
    return 'ONE_WAY';
  }

  if (!allowTestnetAutoFix) {
    throw new Error(
      'Unsupported Binance Hedge Mode. Grid bot requires ONE_WAY position mode.'
    );
  }

  await client.setPositionMode('ONE_WAY');

  const verified = await client.getPositionMode();
  if (verified !== 'ONE_WAY') {
    throw new Error(
      'Binance position-mode verification failed after TESTNET auto-fix.'
    );
  }

  return 'ONE_WAY';
}
