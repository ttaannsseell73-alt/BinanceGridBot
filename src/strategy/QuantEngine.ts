import { PriceActionFeatures, MicrostructureFeatures, QuantScore } from '../models/strategy';

type ReturnBasis = 'RAW_ROUND_TRIP' | 'NET_GRID_EPISODE';

interface Observation {
  exactHash: string;
  paHash: string;
  forwardReturn: number;
  holdingTimeMs: number;
  returnBasis: ReturnBasis;
}

interface SerializedObservationV1 {
  exactHash: string;
  paHash: string;
  forwardReturn: number;
  holdingTimeMs: number;
}

interface SerializedObservationV2 extends SerializedObservationV1 {
  returnBasis: ReturnBasis;
}

export interface QuantConfig {
  feeRate: number;
  syntheticSlippage: number;
  minSamples: number;
}

export interface QuantModelV1 {
  version: 1;
  createdAt: number;
  observations: SerializedObservationV1[];
}

export interface QuantModelV2 {
  version: 2;
  createdAt: number;
  label: 'MIXED_RETURN_BASIS';
  observations: SerializedObservationV2[];
  training?: Record<string, unknown>;
}

export type QuantModel = QuantModelV1 | QuantModelV2;

export class QuantEngine {
  private observations: Observation[] = [];
  private config: QuantConfig;
  private trainingMetadata: Record<string, unknown> | undefined;

  constructor(config: QuantConfig) {
    this.config = config;
  }

  /**
   * Legacy/raw observation path. Costs are deducted during evaluate().
   */
  public recordObservation(
    pa: PriceActionFeatures,
    ms: MicrostructureFeatures,
    forwardReturn: number,
    holdingTimeMs: number
  ): void {
    this.record(pa, ms, forwardReturn, holdingTimeMs, 'RAW_ROUND_TRIP');
  }

  /**
   * Preferred grid-training path. The supplied return already includes the
   * modeled execution costs, so evaluate() must NOT deduct them again.
   */
  public recordNetObservation(
    pa: PriceActionFeatures,
    ms: MicrostructureFeatures,
    netReturn: number,
    holdingTimeMs: number
  ): void {
    this.record(pa, ms, netReturn, holdingTimeMs, 'NET_GRID_EPISODE');
  }

  private record(
    pa: PriceActionFeatures,
    ms: MicrostructureFeatures,
    forwardReturn: number,
    holdingTimeMs: number,
    returnBasis: ReturnBasis
  ): void {
    if (!Number.isFinite(forwardReturn) || !Number.isFinite(holdingTimeMs)) {
      return;
    }

    this.observations.push({
      exactHash: this.hashFeatures(pa, ms),
      paHash: this.hashPriceAction(pa),
      forwardReturn,
      holdingTimeMs: Math.max(0, holdingTimeMs),
      returnBasis
    });
  }

  public setTrainingMetadata(metadata: Record<string, unknown>): void {
    this.trainingMetadata = { ...metadata };
  }

  public getObservationCount(): number {
    return this.observations.length;
  }

  public getExactFeatureHash(
    pa: PriceActionFeatures,
    ms: MicrostructureFeatures
  ): string {
    return this.hashFeatures(pa, ms);
  }

  public exportModel(): QuantModelV2 {
    return {
      version: 2,
      createdAt: Date.now(),
      label: 'MIXED_RETURN_BASIS',
      observations: this.observations.map(o => ({ ...o })),
      training: this.trainingMetadata ? { ...this.trainingMetadata } : undefined
    };
  }

  public importModel(model: QuantModel): number {
    if (!model || !Array.isArray((model as QuantModel).observations)) {
      throw new Error('Unsupported or invalid quant model');
    }

    if (model.version !== 1 && model.version !== 2) {
      throw new Error('Unsupported or invalid quant model');
    }

    const sanitized: Observation[] = [];

    for (const raw of model.observations) {
      if (
        typeof raw?.exactHash !== 'string' ||
        typeof raw?.paHash !== 'string' ||
        !Number.isFinite(raw?.forwardReturn) ||
        !Number.isFinite(raw?.holdingTimeMs)
      ) {
        continue;
      }

      const returnBasis: ReturnBasis =
        model.version === 2 &&
        'returnBasis' in raw &&
        raw.returnBasis === 'NET_GRID_EPISODE'
          ? 'NET_GRID_EPISODE'
          : 'RAW_ROUND_TRIP';

      sanitized.push({
        exactHash: raw.exactHash,
        paHash: raw.paHash,
        forwardReturn: raw.forwardReturn,
        holdingTimeMs: Math.max(0, raw.holdingTimeMs),
        returnBasis
      });
    }

    this.observations = sanitized;
    this.trainingMetadata = model.version === 2 ? model.training : undefined;
    return this.observations.length;
  }

  public evaluate(pa: PriceActionFeatures, ms: MicrostructureFeatures): QuantScore {
    const exactHash = this.hashFeatures(pa, ms);
    const exactMatches = this.observations.filter(o => o.exactHash === exactHash);

    if (exactMatches.length >= this.config.minSamples) {
      return this.calculateScore(exactMatches, 'EXACT', exactHash);
    }

    /*
     * Historical kline replay deliberately has no true trade-level
     * microstructure/OI. Live trading does. PA-only fallback is therefore the
     * conservative bridge; it never fabricates historical order-flow data.
     */
    const paHash = this.hashPriceAction(pa);
    const paMatches = this.observations.filter(o => o.paHash === paHash);

    if (paMatches.length >= this.config.minSamples) {
      return this.calculateScore(paMatches, 'PA_FALLBACK', paHash);
    }

    return {
      sampleCount: paMatches.length,
      hitRate: 0,
      expectancy: 0,
      averageWin: 0,
      averageLoss: 0,
      mae: 0,
      mfe: 0,
      modelSource: 'NONE',
      featureHash: paHash
    };
  }

  private calculateScore(
    observations: Observation[],
    modelSource: 'EXACT' | 'PA_FALLBACK',
    featureHash: string
  ): QuantScore {
    const sampleCount = observations.length;
    let wins = 0;
    let totalWinReturn = 0;
    let totalLossReturn = 0;
    let maxWin = 0;
    let maxLoss = 0;
    let totalHoldingTimeMs = 0;

    const rawRoundTripPenalty =
      (this.config.feeRate * 2) +
      (this.config.syntheticSlippage * 2);

    for (const obs of observations) {
      const netReturn =
        obs.returnBasis === 'NET_GRID_EPISODE'
          ? obs.forwardReturn
          : obs.forwardReturn - rawRoundTripPenalty;

      totalHoldingTimeMs += obs.holdingTimeMs;

      if (netReturn > 0) {
        wins++;
        totalWinReturn += netReturn;
        if (netReturn > maxWin) maxWin = netReturn;
      } else {
        totalLossReturn += netReturn;
        if (netReturn < maxLoss) maxLoss = netReturn;
      }
    }

    const hitRate = sampleCount > 0 ? wins / sampleCount : 0;
    const losses = sampleCount - wins;
    const averageWin = wins > 0 ? totalWinReturn / wins : 0;
    const averageLoss = losses > 0 ? totalLossReturn / losses : 0;
    const expectancy =
      (hitRate * averageWin) +
      ((1 - hitRate) * averageLoss);

    return {
      sampleCount,
      hitRate,
      expectancy,
      averageWin,
      averageLoss,
      mae: maxLoss,
      mfe: maxWin,
      expectedDurationMs: sampleCount > 0 ? totalHoldingTimeMs / sampleCount : 0,
      modelSource,
      featureHash
    };
  }

  private hashPriceAction(pa: PriceActionFeatures): string {
    return [
      `MS:${pa.marketStructure}`,
      `RNG:${pa.inRange}`,
      `B_UP:${pa.breakoutUp}`,
      `B_DN:${pa.breakoutDown}`,
      `S_UP:${pa.liquiditySweepUp}`,
      `S_DN:${pa.liquiditySweepDown}`
    ].join('|');
  }

  private hashFeatures(pa: PriceActionFeatures, ms: MicrostructureFeatures): string {
    const cvdDirection =
      ms.cvd === 'UNAVAILABLE_DUE_TO_DATA'
        ? 'UNAVAILABLE'
        : (ms.cvd > 0 ? 'pos' : (ms.cvd < 0 ? 'neg' : 'flat'));

    const oiDirection =
      ms.oiDelta === 'UNAVAILABLE_DUE_TO_DATA'
        ? 'UNAVAILABLE'
        : (ms.oiDelta > 0 ? 'pos' : (ms.oiDelta < 0 ? 'neg' : 'flat'));

    const imbalanceLevel =
      ms.takerImbalance === 'UNAVAILABLE_DUE_TO_DATA'
        ? 'UNAVAILABLE'
        : (ms.takerImbalance > 1.5
          ? 'high_buy'
          : (ms.takerImbalance < 0.66 ? 'high_sell' : 'neutral'));

    const absLevel =
      ms.absorption === 'UNAVAILABLE_DUE_TO_DATA'
        ? 'UNAVAILABLE'
        : String(ms.absorption);

    return [
      this.hashPriceAction(pa),
      `CVD:${cvdDirection}`,
      `IMB:${imbalanceLevel}`,
      `OI:${oiDirection}`,
      `ABS:${absLevel}`
    ].join('|');
  }
}
