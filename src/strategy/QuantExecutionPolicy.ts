import { MicrostructureFeatures, PriceActionFeatures, QuantScore } from '../models/strategy';
import { areLiveQuantFeaturesReady } from './FeatureReadiness';

export type QuantExecutionMode =
  | 'SHADOW'
  | 'SMOKE_TESTNET'
  | 'REAL_TESTNET'
  | 'REAL_LIVE';

export interface QuantExecutionDecision {
  canExecute: boolean;
  score: QuantScore | null;
  priceAction: PriceActionFeatures | null;
  reason:
    | 'SHADOW_MODE'
    | 'SMOKE_TESTNET'
    | 'REAL_QUANT_READY'
    | 'REAL_QUANT_UNAVAILABLE';
}

const TESTNET_REST_HOST = 'testnet.binancefuture.com';
const TESTNET_WS_HOST = 'stream.binancefuture.com';

function hostname(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

export function isBinanceTestnetPair(restUrl: string, wsUrl: string): boolean {
  return (
    hostname(restUrl) === TESTNET_REST_HOST &&
    hostname(wsUrl) === TESTNET_WS_HOST
  );
}

export function assertQuantExecutionModeSafe(params: {
  mode: QuantExecutionMode;
  restUrl: string;
  wsUrl: string;
  liveQuantAcknowledgement?: string;
}): void {
  const testnet = isBinanceTestnetPair(params.restUrl, params.wsUrl);

  if (
    (params.mode === 'SMOKE_TESTNET' || params.mode === 'REAL_TESTNET') &&
    !testnet
  ) {
    throw new Error(
      `Refusing ${params.mode} outside Binance Futures testnet`
    );
  }

  if (params.mode === 'REAL_LIVE') {
    if (testnet) {
      throw new Error('REAL_LIVE cannot run against Binance Futures testnet');
    }

    const acknowledged =
      String(params.liveQuantAcknowledgement ?? '')
        .trim()
        .toLowerCase() === 'yes';

    if (!acknowledged) {
      throw new Error(
        'Refusing REAL_LIVE without I_UNDERSTAND_QUANT_LIVE=yes'
      );
    }
  }
}

export function resolveQuantExecution(params: {
  mode: QuantExecutionMode;
  realQuantScore: QuantScore | null;
  activePriceAction: PriceActionFeatures | null;
  activeMicrostructure: MicrostructureFeatures | null;
  smokeScore: QuantScore;
}): QuantExecutionDecision {
  if (params.mode === 'SHADOW') {
    return {
      canExecute: false,
      score: null,
      priceAction: null,
      reason: 'SHADOW_MODE'
    };
  }

  if (params.mode === 'SMOKE_TESTNET') {
    return {
      canExecute: true,
      score: params.smokeScore,
      priceAction: null,
      reason: 'SMOKE_TESTNET'
    };
  }

  if (
    params.realQuantScore === null ||
    !areLiveQuantFeaturesReady(
      params.activePriceAction,
      params.activeMicrostructure
    ) ||
    (
      params.realQuantScore.modelSource !== 'EXACT' &&
      !(
        params.mode === 'REAL_TESTNET' &&
        params.realQuantScore.modelSource === 'BALANCED'
      )
    )
  ) {
    return {
      canExecute: false,
      score: null,
      priceAction: null,
      reason: 'REAL_QUANT_UNAVAILABLE'
    };
  }

  return {
    canExecute: true,
    score: params.realQuantScore,
    priceAction: params.activePriceAction,
    reason: 'REAL_QUANT_READY'
  };
}
