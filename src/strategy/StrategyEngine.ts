import { OrderIntent, LifecycleState } from '../models/types';
import crypto from 'crypto';

import { QuantScore } from '../models/strategy';

export interface StrategyConfig {
  symbol: string;
  gridLevels: number; // e.g. 5
  gridSpacing: number; // e.g. 10 USDT
  baseOrderQty: number; // e.g. 0.01 BTC
  skewFactor: number; // e.g. 0.5 (shifts mid price based on inventory)
  minExpectancy: number; // Minimum edge to run grid
  minSamples: number; // Minimum samples to trust expectancy
  safetyMultiplier: number; // For economic edge gate (e.g. 2.0)
  expectedCostBps: number; // Estimated cost per round trip (e.g. 0.0010 for 10 bps)
}

export class StrategyEngine {
  constructor(private config: StrategyConfig) {}

  public generateGrid(currentPrice: number, paFeatures: any, currentPosition: number, quantScore: QuantScore): OrderIntent[] {
    const intents: OrderIntent[] = [];
    
    // Check quant validation gates (Sample Size)
    if (quantScore.sampleCount < this.config.minSamples) {
      return intents;
    }

    // 1. ABLATION INTEGRITY & ECONOMIC EDGE GATE
    // Gross capture is expectancy + expected cost.
    // E.g., if expectancy is net return, and expected cost is fee + slippage
    // expected_gross_capture = quantScore.expectancy + config.expectedCostBps
    // Economic Gate: expected_gross_capture > total_expected_cost * safety_multiplier
    
    const expectedGrossCapture = quantScore.expectancy + this.config.expectedCostBps;
    const requiredGrossCapture = this.config.expectedCostBps * this.config.safetyMultiplier;

    if (expectedGrossCapture < requiredGrossCapture || quantScore.expectancy < this.config.minExpectancy) {
      // Do not run grid if there is no economic edge
      return intents;
    }

    // 2. DYNAMIC GRID SPACING
    // Use realized range if available, fallback to static config
    let dynamicSpacing = this.config.gridSpacing;
    if (paFeatures && paFeatures.rangeHigh && paFeatures.rangeLow) {
       const range = paFeatures.rangeHigh - paFeatures.rangeLow;
       // spacing could be range / (levels * 2)
       if (range > 0) {
          dynamicSpacing = range / (this.config.gridLevels * 1.5);
          // Clamp to reasonable minimum to avoid overtrading noise
          if (dynamicSpacing < currentPrice * 0.001) {
             dynamicSpacing = currentPrice * 0.001; // min 10 bps spacing
          }
       }
    }

    // Inventory skew: Shift the "mid" price away from current price based on position
    const skewOffset = currentPosition * this.config.skewFactor * dynamicSpacing;
    const effectiveMidPrice = currentPrice - skewOffset;

    for (let i = 1; i <= this.config.gridLevels; i++) {
      // BUY Levels (Below mid price)
      const buyPrice = effectiveMidPrice - (i * dynamicSpacing);
      intents.push(this.createIntent('BUY', buyPrice, this.config.baseOrderQty));

      // SELL Levels (Above mid price)
      const sellPrice = effectiveMidPrice + (i * dynamicSpacing);
      intents.push(this.createIntent('SELL', sellPrice, this.config.baseOrderQty));
    }

    return intents;
  }

  private createIntent(side: 'BUY' | 'SELL', price: number, qty: number): OrderIntent {
    return {
      clientOrderId: `grid-${crypto.randomUUID().substring(0, 8)}`,
      exchangeOrderId: null,
      symbol: this.config.symbol,
      side,
      price,
      originalQuantity: qty,
      remainingQuantity: qty,
      cumulativeExecutedQuantity: 0,
      state: LifecycleState.INTENT_CREATED,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }
}

