import { Candle, MicrostructureFeatures } from '../models/strategy';
import { PriceActionEngine } from '../strategy/PriceActionEngine';
import { QuantEngine } from '../strategy/QuantEngine';

export interface GridTrainingConfig {
  gridLevels: number;
  gridSpacing: number;
  baseOrderQty: number;
  horizonCandles: number;
  strideCandles: number;
  warmupCandles: number;
  makerFeeRate: number;
  syntheticSlippageRate: number;
}

export interface VirtualGridOutcome {
  netReturn: number;
  grossPnl: number;
  netPnl: number;
  filledOrders: number;
  terminalPosition: number;
  riskNotional: number;
}

const HISTORICAL_MS: MicrostructureFeatures = {
  cvd: 'UNAVAILABLE_DUE_TO_DATA',
  takerImbalance: 'UNAVAILABLE_DUE_TO_DATA',
  oiDelta: 'UNAVAILABLE_DUE_TO_DATA',
  absorption: 'UNAVAILABLE_DUE_TO_DATA'
};

/**
 * Simulates one fixed grid batch from decision time through a bounded horizon.
 * Orders are resting limits and each level can fill once. Unpaired terminal
 * inventory is marked to market and conservatively charged an exit cost.
 * No future data is used to build the decision-time PA snapshot.
 */
export function simulateVirtualGridOutcome(
  anchorPrice: number,
  futureCandles: Candle[],
  config: Pick<
    GridTrainingConfig,
    'gridLevels' | 'gridSpacing' | 'baseOrderQty' | 'makerFeeRate' | 'syntheticSlippageRate'
  >
): VirtualGridOutcome {
  if (anchorPrice <= 0 || futureCandles.length === 0) {
    return {
      netReturn: 0,
      grossPnl: 0,
      netPnl: 0,
      filledOrders: 0,
      terminalPosition: 0,
      riskNotional: 0
    };
  }

  const buyLevels = Array.from(
    { length: config.gridLevels },
    (_, i) => anchorPrice - ((i + 1) * config.gridSpacing)
  );
  const sellLevels = Array.from(
    { length: config.gridLevels },
    (_, i) => anchorPrice + ((i + 1) * config.gridSpacing)
  );

  const buyFilled = new Array(config.gridLevels).fill(false);
  const sellFilled = new Array(config.gridLevels).fill(false);

  let cashFlow = 0;
  let position = 0;
  let entryCosts = 0;
  let filledOrders = 0;

  const perFillCostRate = config.makerFeeRate + config.syntheticSlippageRate;

  for (const candle of futureCandles) {
    for (let i = 0; i < config.gridLevels; i++) {
      const buyPrice = buyLevels[i];
      if (!buyFilled[i] && candle.low <= buyPrice) {
        buyFilled[i] = true;
        const notional = buyPrice * config.baseOrderQty;
        cashFlow -= notional;
        position += config.baseOrderQty;
        entryCosts += notional * perFillCostRate;
        filledOrders++;
      }

      const sellPrice = sellLevels[i];
      if (!sellFilled[i] && candle.high >= sellPrice) {
        sellFilled[i] = true;
        const notional = sellPrice * config.baseOrderQty;
        cashFlow += notional;
        position -= config.baseOrderQty;
        entryCosts += notional * perFillCostRate;
        filledOrders++;
      }
    }
  }

  const terminalPrice = futureCandles[futureCandles.length - 1].close;
  const terminalMarkToMarket = position * terminalPrice;
  const grossPnl = cashFlow + terminalMarkToMarket;

  // Convert any remaining directional inventory to a fully comparable,
  // realized-equivalent result at the horizon boundary.
  const terminalExitNotional = Math.abs(position) * terminalPrice;
  const terminalExitCosts = terminalExitNotional * perFillCostRate;
  const netPnl = grossPnl - entryCosts - terminalExitCosts;

  // One-sided maximum inventory is the capital-at-risk denominator.
  const riskNotional =
    anchorPrice * config.baseOrderQty * Math.max(1, config.gridLevels);

  return {
    netReturn: riskNotional > 0 ? netPnl / riskNotional : 0,
    grossPnl,
    netPnl,
    filledOrders,
    terminalPosition: position,
    riskNotional
  };
}

export class QuantTrainer {
  private readonly config: GridTrainingConfig;

  constructor(config: GridTrainingConfig) {
    this.config = config;
  }

  public train(klines: Candle[], quant: QuantEngine): number {
    const paEngine = new PriceActionEngine();
    let recorded = 0;

    for (let i = 0; i < klines.length; i++) {
      const candle = klines[i];
      const pa = paEngine.processCandle(candle);

      if (!candle.isClosed) continue;
      if (i < this.config.warmupCandles) continue;
      if ((i - this.config.warmupCandles) % this.config.strideCandles !== 0) continue;

      const endExclusive = i + 1 + this.config.horizonCandles;
      if (endExclusive > klines.length) break;

      const futureCandles = klines.slice(i + 1, endExclusive);
      const outcome = simulateVirtualGridOutcome(
        candle.close,
        futureCandles,
        this.config
      );

      quant.recordNetObservation(
        pa,
        HISTORICAL_MS,
        outcome.netReturn,
        this.config.horizonCandles * 60_000
      );
      recorded++;
    }

    quant.setTrainingMetadata({
      trainer: 'FIXED_HORIZON_VIRTUAL_GRID_V2',
      gridLevels: this.config.gridLevels,
      gridSpacing: this.config.gridSpacing,
      baseOrderQty: this.config.baseOrderQty,
      horizonCandles: this.config.horizonCandles,
      strideCandles: this.config.strideCandles,
      warmupCandles: this.config.warmupCandles,
      makerFeeRate: this.config.makerFeeRate,
      syntheticSlippageRate: this.config.syntheticSlippageRate,
      observations: recorded,
      microstructure: 'UNAVAILABLE_HISTORICALLY_PA_FALLBACK_ONLY'
    });

    return recorded;
  }
}
