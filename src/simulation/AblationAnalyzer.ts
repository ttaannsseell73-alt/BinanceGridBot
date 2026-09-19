import { Candle } from '../models/strategy';
import { StrategyConfig } from '../strategy/StrategyEngine';
import { HistoricalSimulator } from './HistoricalSimulator';
import { SimulationReport } from './MetricsEngine';

export interface AblationResult {
  maskName: string;
  report: SimulationReport;
}

export class AblationAnalyzer {
  constructor(private baseConfig: StrategyConfig) {}

  public async run(klines: Candle[]): Promise<AblationResult[]> {
    const results: AblationResult[] = [];

    // Base run
    console.log(`Running FULL model ablation...`);
    const baseSim = new HistoricalSimulator(this.baseConfig);
    results.push({ maskName: 'Full Model', report: await baseSim.run(klines, false) });

    const ablationSets = [
      { name: 'No Market Structure', mask: { pa: [], ms: ['absorption', 'exhaustion'] } },
      { name: 'No Liquidity Voids', mask: { pa: ['liquidityVoids'], ms: [] } },
      { name: 'No Momentum', mask: { pa: ['momentum'], ms: [] } },
      { name: 'No Volatility', mask: { pa: ['volatility'], ms: [] } }
    ];

    for (const set of ablationSets) {
      console.log(`Running Ablation: ${set.name}...`);
      const sim = new HistoricalSimulator(this.baseConfig);
      const report = await sim.run(klines, false, set.mask);
      results.push({ maskName: set.name, report });
    }

    return results;
  }
}
