import { DataLoader } from './DataLoader';
import { HistoricalSimulator } from './HistoricalSimulator';
import { StrategyConfig } from '../strategy/StrategyEngine';
import { WalkForwardValidator } from './WalkForwardValidator';
import { AblationAnalyzer } from './AblationAnalyzer';
import fs from 'fs';
import path from 'path';

async function run() {
  const loader = new DataLoader();
  
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  const interval = '1m';
  
  // 90 days of data
  const endTime = Date.now();
  const startTime = endTime - (90 * 24 * 60 * 60 * 1000);
  
  const artifactsDir = path.join(process.cwd(), 'artifacts');
  if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir);
  }

  const crossSymbolResults: Record<string, any> = {};

  for (const symbol of symbols) {
    console.log(`\n==================================================`);
    console.log(`Fetching data for ${symbol}...`);
    const klines = await loader.getKlines(symbol, interval, startTime, endTime);
    console.log(`Loaded ${klines.length} klines for ${symbol}.`);

    if (klines.length < 1000) {
        console.warn(`Not enough data for ${symbol}. Skipping.`);
        continue;
    }

    // Adapt baseOrderQty based on asset roughly (BTC: 0.01, ETH: 0.2, SOL: 1)
    let qty = 0.01;
    if (symbol === 'ETHUSDT') qty = 0.2;
    if (symbol === 'SOLUSDT') qty = 1;

    const baseConfig: StrategyConfig = {
      symbol,
      gridLevels: 5,
      gridSpacing: 50, // Will be overridden dynamically by ATR/PA
      baseOrderQty: qty,
      skewFactor: 0.5,
      minExpectancy: 0.0010, // Must have at least 10 bps raw expectancy 
      minSamples: 10,        // Require at least 10 historical samples in QuantEngine
      safetyMultiplier: 1.5, // Require 1.5x expected cost coverage
      expectedCostBps: 0.0018 // ~18 bps round trip (4 bps fee + 5 bps slippage per leg)
    };

    // 1. Walk-Forward Validation (BASE friction)
    console.log(`\n--- Running Walk-Forward Validation for ${symbol} ---`);
    const wfValidator = new WalkForwardValidator(baseConfig);
    const wfResults = await wfValidator.run(klines, 43200, 10080);
    fs.writeFileSync(path.join(artifactsDir, `walk_forward_${symbol}.json`), JSON.stringify(wfResults, null, 2));

    // 2. Ablation Analysis (Full Dataset)
    console.log(`\n--- Running Ablation Analysis for ${symbol} ---`);
    const ablation = new AblationAnalyzer(baseConfig);
    const ablationResults = await ablation.run(klines);
    fs.writeFileSync(path.join(artifactsDir, `ablation_${symbol}.json`), JSON.stringify(ablationResults, null, 2));

    // 3. Stress Testing (Friction Scaling)
    console.log(`\n--- Running Friction Stress Tests for ${symbol} ---`);
    const stressScenarios = [
      { name: 'LOW_FRICTION', feeBps: 2, slippageBps: 1 },
      { name: 'BASE_FRICTION', feeBps: 4, slippageBps: 5 },
      { name: 'STRESS_FRICTION', feeBps: 6, slippageBps: 15 }
    ];

    const stressResults = [];
    for (const scenario of stressScenarios) {
      console.log(`Evaluating ${scenario.name}...`);
      const sim = new HistoricalSimulator(baseConfig, scenario.feeBps, scenario.slippageBps);
      const res = await sim.run(klines);
      stressResults.push({ scenario: scenario.name, report: res });
    }
    fs.writeFileSync(path.join(artifactsDir, `stress_${symbol}.json`), JSON.stringify(stressResults, null, 2));

    crossSymbolResults[symbol] = {
      wfNetPnl: wfResults.length > 0 ? wfResults[wfResults.length - 1].outOfSampleReport.netPnl : 0,
      ablationBasePnl: ablationResults.length > 0 ? ablationResults[0].report.netPnl : 0,
      stressBasePnl: stressResults[1].report.netPnl
    };
  }

  console.log('\n--- Cross-Symbol Robustness Summary ---');
  console.log(crossSymbolResults);
  fs.writeFileSync(path.join(artifactsDir, 'cross_symbol_summary.json'), JSON.stringify(crossSymbolResults, null, 2));
}

run().catch(console.error);

