import { HistoricalSimulator } from './src/simulation/HistoricalSimulator';
import { StrategyConfig } from './src/strategy/StrategyEngine';
import { Candle } from './src/models/strategy';

const config: StrategyConfig = {
  symbol: 'BTCUSDT',
  gridLevels: 3,
  gridSpacing: 100,
  baseOrderQty: 0.1,
  skewFactor: 0.5,
  minExpectancy: -1,
  minSamples: 0
};

async function run() {
  const simulator = new HistoricalSimulator(config, 10000);
  
  const klines: Candle[] = [
    { timestamp: 1000, open: 50000, high: 50100, low: 49900, close: 50000, volume: 100, takerBuyBaseAssetVolume: 50, isClosed: true },
    { timestamp: 2000, open: 50000, high: 50200, low: 49800, close: 50100, volume: 150, takerBuyBaseAssetVolume: 75, isClosed: true },
    { timestamp: 3000, open: 50100, high: 50300, low: 49700, close: 49800, volume: 200, takerBuyBaseAssetVolume: 100, isClosed: true }
  ];

  const report = await simulator.run(klines);
  console.log("Report:", report);
  
  // @ts-ignore
  console.log("Journal:", simulator.journal.getAllIntents());
}

run().catch(console.error);
