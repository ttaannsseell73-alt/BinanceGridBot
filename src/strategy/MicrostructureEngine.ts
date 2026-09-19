import { Tick, MicrostructureFeatures } from '../models/strategy';
import { OiDelta } from './OpenInterestTracker';

export class MicrostructureEngine {
  private ticks: Tick[] = [];
  private readonly windowMs: number;
  private currentCVD: number = 0;

  constructor(windowMs: number = 60000) {
    this.windowMs = windowMs; // Default 60 seconds rolling window
  }

  public processTick(tick: Tick, currentOiDelta: OiDelta): MicrostructureFeatures {
    this.ticks.push(tick);
    
    // Accumulate CVD across all time, not just rolling window
    // Taker buyer => market buy => positive delta. 
    // Binance `isBuyerMaker: true` means the maker was the buyer, so the taker was the seller (sell market order).
    const direction = tick.isBuyerMaker ? -1 : 1;
    this.currentCVD += (tick.quantity * direction);

    // Prune old ticks for windowed metrics
    const cutoff = tick.timestamp - this.windowMs;
    while (this.ticks.length > 0 && this.ticks[0].timestamp < cutoff) {
      this.ticks.shift();
    }

    // Calculate Taker Imbalance and Absorption in the rolling window
    let buyVolume = 0;
    let sellVolume = 0;
    let maxPrice = -Infinity;
    let minPrice = Infinity;

    for (const t of this.ticks) {
      if (t.isBuyerMaker) {
        sellVolume += t.quantity;
      } else {
        buyVolume += t.quantity;
      }
      if (t.price > maxPrice) maxPrice = t.price;
      if (t.price < minPrice) minPrice = t.price;
    }

    // Taker Imbalance: Ratio of buy to sell volume (bounded safely)
    const takerImbalance = sellVolume === 0 ? (buyVolume > 0 ? 100 : 1) : (buyVolume / sellVolume);

    // Absorption: High volume, but low price movement in the window
    // Define "high volume" abstractly as sum > threshold. We will leave it generic here.
    const totalVolume = buyVolume + sellVolume;
    const priceRange = maxPrice === -Infinity ? 0 : (maxPrice - minPrice) / minPrice;
    
    // Simple heuristic: if total volume is > 0 and price range is less than 0.05% (0.0005)
    // In a real scenario, this threshold would be dynamic or ATR based.
    const absorption = totalVolume > 0 && priceRange < 0.0005;

    return {
      cvd: this.currentCVD,
      takerImbalance,
      oiDelta: currentOiDelta,
      absorption
    };
  }
}
