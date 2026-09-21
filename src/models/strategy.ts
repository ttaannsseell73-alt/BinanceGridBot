export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
  takerBuyBaseAssetVolume?: number;
}

export interface Tick {
  timestamp: number;
  price: number;
  quantity: number;
  isBuyerMaker: boolean; // true = taker sell, false = taker buy
}

export interface PriceActionFeatures {
  swingHighs: { price: number; timestamp: number }[];
  swingLows: { price: number; timestamp: number }[];
  marketStructure: 'HH' | 'HL' | 'LH' | 'LL' | 'NONE';
  inRange: boolean;
  rangeHigh: number | null;
  rangeLow: number | null;
  breakoutUp: boolean;
  breakoutDown: boolean;
  liquiditySweepUp: boolean;
  liquiditySweepDown: boolean;
}

export interface MicrostructureFeatures {
  cvd: number | 'UNAVAILABLE_DUE_TO_DATA'; // Cumulative Volume Delta
  takerImbalance: number | 'UNAVAILABLE_DUE_TO_DATA'; // Buy Vol / Sell Vol
  oiDelta: number | 'UNAVAILABLE_DUE_TO_DATA'; // Open Interest change
  absorption: boolean | 'UNAVAILABLE_DUE_TO_DATA'; // High volume, low price movement
}

export interface QuantScore {
  sampleCount: number;
  hitRate: number;
  expectancy: number; // Average expected outcome considering wins and losses
  averageWin: number;
  averageLoss: number;
  mae: number; // Maximum Adverse Excursion
  mfe: number; // Maximum Favorable Excursion
  expectedDurationMs?: number;
  modelSource?: 'EXACT' | 'BALANCED' | 'PA_FALLBACK' | 'NONE';
  featureHash?: string;
}

export interface StrategySignal {
  symbol: string;
  timestamp: number;
  priceAction: PriceActionFeatures;
  microstructure: MicrostructureFeatures;
  quantScore: QuantScore;
}
