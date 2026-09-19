import { Candle } from '../models/strategy';
import { StrategyConfig } from '../strategy/StrategyEngine';
import { QuantEngine } from '../strategy/QuantEngine';
import { HistoricalSimulator } from './HistoricalSimulator';
import { SimulationReport } from './MetricsEngine';

export interface WalkForwardResult {
  periodIndex: number;
  inSampleReport: SimulationReport;
  outOfSampleReport: SimulationReport;
}

export class WalkForwardValidator {
  constructor(private baseConfig: StrategyConfig) {}

  public async run(
    klines: Candle[],
    trainWindowSize: number = 500,
    testWindowSize: number = 100
  ): Promise<WalkForwardResult[]> {
    const results: WalkForwardResult[] = [];

    let startIndex = 0;
    let periodIndex = 1;

    while (
      startIndex + trainWindowSize + testWindowSize <=
      klines.length
    ) {
      const trainData =
        klines.slice(
          startIndex,
          startIndex + trainWindowSize
        );

      const testData =
        klines.slice(
          startIndex + trainWindowSize,
          startIndex + trainWindowSize + testWindowSize
        );

      console.log(
        `Period ${periodIndex} | IS: ${trainData.length} candles | OOS: ${testData.length} candles`
      );

      /*
       * One QuantEngine per walk-forward period.
       *
       * IS writes observations into it.
       * OOS receives THE SAME instance but run(..., true)
       * freezes learning and only evaluates.
       */
      const trainedQuant = new QuantEngine({
        feeRate: 0.0004,
        syntheticSlippage: 0.0001,
        minSamples: this.baseConfig.minSamples
      });

      const isSimulator =
        new HistoricalSimulator(
          this.baseConfig,
          10000,
          1,
          2,
          trainedQuant
        );

      const isReport =
        await isSimulator.run(
          trainData,
          false
        );

      const oosSimulator =
        new HistoricalSimulator(
          this.baseConfig,
          10000,
          1,
          2,
          trainedQuant
        );

      const oosReport =
        await oosSimulator.run(
          testData,
          true
        );

      results.push({
        periodIndex,
        inSampleReport: isReport,
        outOfSampleReport: oosReport
      });

      startIndex += testWindowSize;
      periodIndex++;
    }

    return results;
  }
}
