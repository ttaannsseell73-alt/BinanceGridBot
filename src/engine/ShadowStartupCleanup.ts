import { IBinanceClient } from '../gateways/IBinanceClient';
import { executeEmergencyExit, EmergencyExitResult } from './EmergencyExitEngine';

export interface ShadowStartupCleanupResult {
  performed: boolean;
  exit: EmergencyExitResult | null;
}

export async function sanitizeShadowStartup(
  client: IBinanceClient,
  symbol: string,
  enabled: boolean
): Promise<ShadowStartupCleanupResult> {
  if (!enabled) {
    return { performed: false, exit: null };
  }

  const exit = await executeEmergencyExit(client, symbol);

  return {
    performed: true,
    exit
  };
}
