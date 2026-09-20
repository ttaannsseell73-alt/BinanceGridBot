import {
  Candle,
  MicrostructureFeatures,
  PriceActionFeatures
} from '../models/strategy';
import { QuantEngine } from '../strategy/QuantEngine';
import { isCompleteMicrostructure } from '../strategy/FeatureReadiness';
import {
  simulateVirtualGridOutcome,
  VirtualGridOutcome
} from './QuantTrainer';

export interface LiveQuantObserverConfig {
  gridLevels: number;
  gridSpacing: number;
  baseOrderQty: number;
  horizonCandles: number;
  strideCandles: number;
  makerFeeRate: number;
  syntheticSlippageRate: number;
}

export interface LiveQuantObservationEvent {
  anchorTimestamp: number;
  completedTimestamp: number;
  exactHash: string;
  outcome: VirtualGridOutcome;
  totalRecorded: number;
  pendingEpisodes: number;
}

interface PendingEpisode {
  anchorTimestamp: number;
  anchorPrice: number;
  priceAction: PriceActionFeatures;
  microstructure: MicrostructureFeatures;
  futureCandles: Candle[];
}

function clonePriceAction(pa: PriceActionFeatures): PriceActionFeatures {
  return {
    ...pa,
    swingHighs: pa.swingHighs.map(x => ({ ...x })),
    swingLows: pa.swingLows.map(x => ({ ...x }))
  };
}

function cloneMicrostructure(
  ms: MicrostructureFeatures
): MicrostructureFeatures {
  return { ...ms };
}

/**
 * Passive live observer.
 *
 * It never places orders. At each stride it snapshots the current PA +
 * microstructure state, then waits for a fixed number of future closed 1m
 * candles and labels that state with the same virtual-grid outcome used by
 * historical training. This creates real live-feature observations without
 * risking capital or contaminating labels with actual execution behavior.
 */
export class LiveQuantObserver {
  private pending: PendingEpisode[] = [];
  private processedClosedCandles = 0;
  private totalRecorded = 0;
  private lastTimestamp: number | null = null;

  constructor(
    private readonly config: LiveQuantObserverConfig,
    private readonly quant: QuantEngine,
    private readonly onObservation?: (event: LiveQuantObservationEvent) => void
  ) {
    if (
      config.gridLevels < 1 ||
      config.gridSpacing <= 0 ||
      config.baseOrderQty <= 0 ||
      config.horizonCandles < 1 ||
      config.strideCandles < 1 ||
      config.makerFeeRate < 0 ||
      config.syntheticSlippageRate < 0
    ) {
      throw new Error('Invalid live Quant observer configuration');
    }
  }

  public processClosedCandle(
    candle: Candle,
    pa: PriceActionFeatures | null,
    ms: MicrostructureFeatures | null
  ): number {
    if (!candle.isClosed) return 0;

    if (this.lastTimestamp !== null && candle.timestamp <= this.lastTimestamp) {
      return 0;
    }
    this.lastTimestamp = candle.timestamp;

    let completed = 0;
    const survivors: PendingEpisode[] = [];

    for (const episode of this.pending) {
      episode.futureCandles.push(candle);

      if (episode.futureCandles.length >= this.config.horizonCandles) {
        const outcome = simulateVirtualGridOutcome(
          episode.anchorPrice,
          episode.futureCandles.slice(0, this.config.horizonCandles),
          this.config
        );

        const exactHash = this.quant.getExactFeatureHash(
          episode.priceAction,
          episode.microstructure
        );

        this.quant.recordNetObservation(
          episode.priceAction,
          episode.microstructure,
          outcome.netReturn,
          this.config.horizonCandles * 60_000
        );

        this.totalRecorded += 1;
        completed += 1;

        this.onObservation?.({
          anchorTimestamp: episode.anchorTimestamp,
          completedTimestamp: candle.timestamp,
          exactHash,
          outcome,
          totalRecorded: this.totalRecorded,
          pendingEpisodes: this.pending.length - completed
        });
      } else {
        survivors.push(episode);
      }
    }

    this.pending = survivors;
    this.processedClosedCandles += 1;

    const shouldStart =
      this.processedClosedCandles % this.config.strideCandles === 0;

    if (
      shouldStart &&
      pa !== null &&
      pa.marketStructure !== 'NONE' &&
      isCompleteMicrostructure(ms)
    ) {
      this.pending.push({
        anchorTimestamp: candle.timestamp,
        anchorPrice: candle.close,
        priceAction: clonePriceAction(pa),
        microstructure: cloneMicrostructure(ms),
        futureCandles: []
      });
    }

    return completed;
  }

  public getStats(): {
    processedClosedCandles: number;
    pendingEpisodes: number;
    totalRecorded: number;
  } {
    return {
      processedClosedCandles: this.processedClosedCandles,
      pendingEpisodes: this.pending.length,
      totalRecorded: this.totalRecorded
    };
  }
}
