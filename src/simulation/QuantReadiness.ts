import { QuantModel } from '../strategy/QuantEngine';
import { buildBalancedFeatureHashFromExactHash } from '../strategy/QuantStateBucketing';
import { QuantMatchMode } from '../strategy/QuantRiskProfile';

export interface QuantReadinessState {
  exactHash: string;
  sampleCount: number;
  expectancy: number;
  hitRate: number;
  breakout: boolean;
  executable: boolean;
}

export interface QuantReadinessReport {
  modelVersion: number;
  stateMode: QuantMatchMode;
  totalObservations: number;
  liveExactObservations: number;
  liveExactStates: number;
  executableStates: number;
  minSamples: number;
  minExpectancy: number;
  states: QuantReadinessState[];
}

export interface QuantReadinessConfig {
  minSamples: number;
  minExpectancy: number;
  rawRoundTripPenalty: number;
  stateMode?: QuantMatchMode;
}

interface ReadinessObservation {
  exactHash: string;
  forwardReturn: number;
  returnBasis?: 'RAW_ROUND_TRIP' | 'NET_GRID_EPISODE';
}

export function analyzeQuantReadiness(
  model: QuantModel,
  config: QuantReadinessConfig
): QuantReadinessReport {
  if (config.minSamples < 1 || config.minExpectancy < 0) {
    throw new Error('Invalid Quant readiness configuration');
  }

  const observations = (model.observations as ReadinessObservation[])
    .filter(o =>
      typeof o?.exactHash === 'string' &&
      Number.isFinite(o?.forwardReturn) &&
      !o.exactHash.includes('UNAVAILABLE')
    );

  const stateMode = config.stateMode ?? 'STRICT';
  const groups = new Map<string, ReadinessObservation[]>();

  for (const observation of observations) {
    const stateHash =
      stateMode === 'BALANCED'
        ? buildBalancedFeatureHashFromExactHash(observation.exactHash)
        : observation.exactHash;

    if (!stateHash) continue;

    const group = groups.get(stateHash) ?? [];
    group.push(observation);
    groups.set(stateHash, group);
  }

  const states: QuantReadinessState[] = [];

  for (const [exactHash, group] of groups.entries()) {
    let wins = 0;
    let total = 0;

    for (const observation of group) {
      const netReturn =
        observation.returnBasis === 'NET_GRID_EPISODE'
          ? observation.forwardReturn
          : observation.forwardReturn - config.rawRoundTripPenalty;

      total += netReturn;
      if (netReturn > 0) wins += 1;
    }

    const sampleCount = group.length;
    const expectancy = sampleCount > 0 ? total / sampleCount : 0;
    const hitRate = sampleCount > 0 ? wins / sampleCount : 0;
    const breakout =
      stateMode === 'BALANCED'
        ? exactHash.includes('BRK:YES')
        : (
          exactHash.includes('B_UP:true') ||
          exactHash.includes('B_DN:true')
        );

    states.push({
      exactHash,
      sampleCount,
      expectancy,
      hitRate,
      breakout,
      executable:
        !breakout &&
        sampleCount >= config.minSamples &&
        expectancy >= config.minExpectancy
    });
  }

  states.sort((a, b) => {
    if (a.executable !== b.executable) return a.executable ? -1 : 1;
    if (a.sampleCount !== b.sampleCount) return b.sampleCount - a.sampleCount;
    return b.expectancy - a.expectancy;
  });

  return {
    modelVersion: model.version,
    stateMode,
    totalObservations: model.observations.length,
    liveExactObservations: observations.length,
    liveExactStates: states.length,
    executableStates: states.filter(s => s.executable).length,
    minSamples: config.minSamples,
    minExpectancy: config.minExpectancy,
    states
  };
}
