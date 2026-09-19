import { Candle, PriceActionFeatures } from '../models/strategy';

export class PriceActionEngine {
  private candles: Candle[] = [];
  private readonly pivotLength: number;
  private swingHighs: { price: number; timestamp: number }[] = [];
  private swingLows: { price: number; timestamp: number }[] = [];
  private lastRangeHigh: number | null = null;
  private lastRangeLow: number | null = null;

  constructor(pivotLength: number = 5) {
    this.pivotLength = pivotLength;
  }

  public processCandle(candle: Candle): PriceActionFeatures {
    // We only process closed candles or treat the incoming candle as the latest
    this.candles.push(candle);
    
    // We only keep the necessary history, say 100 candles, to avoid memory leak
    if (this.candles.length > 100) {
      this.candles.shift();
    }

    this.detectPivots();
    const marketStructure = this.detectMarketStructure();
    const { inRange, rangeHigh, rangeLow } = this.detectRange();
    const { breakoutUp, breakoutDown, liquiditySweepUp, liquiditySweepDown } = this.detectBreakoutAndSweep(rangeHigh, rangeLow);

    return {
      swingHighs: [...this.swingHighs],
      swingLows: [...this.swingLows],
      marketStructure,
      inRange,
      rangeHigh,
      rangeLow,
      breakoutUp,
      breakoutDown,
      liquiditySweepUp,
      liquiditySweepDown
    };
  }

  private detectPivots(): void {
    if (this.candles.length < this.pivotLength * 2 + 1) return;

    // The potential pivot is at `currentIndex` = candles.length - 1 - pivotLength
    const pivotIndex = this.candles.length - 1 - this.pivotLength;
    const pivotCandle = this.candles[pivotIndex];

    let isSwingHigh = true;
    let isSwingLow = true;

    for (let i = 1; i <= this.pivotLength; i++) {
      const leftCandle = this.candles[pivotIndex - i];
      const rightCandle = this.candles[pivotIndex + i];

      if (leftCandle.high >= pivotCandle.high || rightCandle.high >= pivotCandle.high) {
        isSwingHigh = false;
      }
      if (leftCandle.low <= pivotCandle.low || rightCandle.low <= pivotCandle.low) {
        isSwingLow = false;
      }
    }

    if (isSwingHigh) {
      // Avoid duplicate insertion
      const exists = this.swingHighs.find(s => s.timestamp === pivotCandle.timestamp);
      if (!exists) {
        this.swingHighs.push({ price: pivotCandle.high, timestamp: pivotCandle.timestamp });
        if (this.swingHighs.length > 5) this.swingHighs.shift();
      }
    }

    if (isSwingLow) {
      const exists = this.swingLows.find(s => s.timestamp === pivotCandle.timestamp);
      if (!exists) {
        this.swingLows.push({ price: pivotCandle.low, timestamp: pivotCandle.timestamp });
        if (this.swingLows.length > 5) this.swingLows.shift();
      }
    }
  }

  private detectMarketStructure(): 'HH' | 'HL' | 'LH' | 'LL' | 'NONE' {
    if (this.swingHighs.length >= 2 && this.swingLows.length >= 2) {
      const lastHigh = this.swingHighs[this.swingHighs.length - 1];
      const prevHigh = this.swingHighs[this.swingHighs.length - 2];
      
      const lastLow = this.swingLows[this.swingLows.length - 1];
      const prevLow = this.swingLows[this.swingLows.length - 2];

      if (lastHigh.price > prevHigh.price && lastLow.price > prevLow.price) {
        return 'HH'; // Higher Highs and Higher Lows -> Uptrend
      } else if (lastHigh.price < prevHigh.price && lastLow.price < prevLow.price) {
        return 'LL'; // Lower Highs and Lower Lows -> Downtrend
      } else if (lastHigh.price < prevHigh.price && lastLow.price > prevLow.price) {
        return 'LH'; // Lower High, Higher Low -> Contraction
      } else if (lastHigh.price > prevHigh.price && lastLow.price < prevLow.price) {
        return 'HL'; // Higher High, Lower Low -> Expansion
      }
    }
    return 'NONE';
  }

  private detectRange(): { inRange: boolean; rangeHigh: number | null; rangeLow: number | null } {
    if (this.swingHighs.length < 2 || this.swingLows.length < 2) {
      return { inRange: false, rangeHigh: this.lastRangeHigh, rangeLow: this.lastRangeLow };
    }

    const lastHigh = this.swingHighs[this.swingHighs.length - 1];
    const prevHigh = this.swingHighs[this.swingHighs.length - 2];
    const lastLow = this.swingLows[this.swingLows.length - 1];
    const prevLow = this.swingLows[this.swingLows.length - 2];

    const highDiff = Math.abs(lastHigh.price - prevHigh.price) / prevHigh.price;
    const lowDiff = Math.abs(lastLow.price - prevLow.price) / prevLow.price;

    // 1% tolerance for range tops/bottoms
    if (highDiff < 0.01 && lowDiff < 0.01) {
      this.lastRangeHigh = Math.max(lastHigh.price, prevHigh.price);
      this.lastRangeLow = Math.min(lastLow.price, prevLow.price);
      return {
        inRange: true,
        rangeHigh: this.lastRangeHigh,
        rangeLow: this.lastRangeLow
      };
    }

    return { inRange: false, rangeHigh: this.lastRangeHigh, rangeLow: this.lastRangeLow };
  }

  private detectBreakoutAndSweep(rangeHigh: number | null, rangeLow: number | null) {
    let breakoutUp = false;
    let breakoutDown = false;
    let liquiditySweepUp = false;
    let liquiditySweepDown = false;

    if (rangeHigh !== null && rangeLow !== null && this.candles.length > 0) {
      const currentCandle = this.candles[this.candles.length - 1];

      // Breakout up: Candle closes above range high
      if (currentCandle.close > rangeHigh) {
        breakoutUp = true;
      }
      
      // Breakout down: Candle closes below range low
      if (currentCandle.close < rangeLow) {
        breakoutDown = true;
      }

      // Sweep Up: Candle wicks above range high, but closes below or equal to range high
      if (currentCandle.high > rangeHigh && currentCandle.close <= rangeHigh) {
        liquiditySweepUp = true;
      }

      // Sweep Down: Candle wicks below range low, but closes above or equal to range low
      if (currentCandle.low < rangeLow && currentCandle.close >= rangeLow) {
        liquiditySweepDown = true;
      }
    }

    return { breakoutUp, breakoutDown, liquiditySweepUp, liquiditySweepDown };
  }
}
