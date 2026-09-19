export interface ExchangeEnvironment {
  restUrl: string;
  wsUrl: string;
  liveAcknowledgement?: string;
}

const TESTNET_REST_HOST = 'testnet.binancefuture.com';
const TESTNET_WS_HOST = 'stream.binancefuture.com';

function hostname(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

export function assertExchangeEnvironmentSafe(env: ExchangeEnvironment): void {
  const restHost = hostname(env.restUrl);
  const wsHost = hostname(env.wsUrl);

  const restIsTestnet = restHost === TESTNET_REST_HOST;
  const wsIsTestnet = wsHost === TESTNET_WS_HOST;

  if (restIsTestnet !== wsIsTestnet) {
    throw new Error(
      `Refusing mixed Binance environments: REST=${restHost}, WS=${wsHost}`
    );
  }

  if (!restIsTestnet) {
    const acknowledged =
      String(env.liveAcknowledgement ?? '').trim().toLowerCase() === 'yes';

    if (!acknowledged) {
      throw new Error(
        'Refusing non-testnet Binance endpoints without I_UNDERSTAND_LIVE=yes'
      );
    }
  }
}
