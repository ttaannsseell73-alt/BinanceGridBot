import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { DataLoader } from './DataLoader';
import { QuantEngine } from '../strategy/QuantEngine';
import { QuantTrainer } from './QuantTrainer';

dotenv.config();

async function main(): Promise<void> {
  const symbol = (process.env.SYMBOL || 'BTCUSDT').toUpperCase();
  const interval = '1m';
  const days = 14;
  const endTime = Date.now();
  const startTime = endTime - (days * 24 * 60 * 60 * 1000);

  const loader = new DataLoader();
  const klines = await loader.getKlines(symbol, interval, startTime, endTime);

  if (klines.length < 1000) {
    throw new Error(`Not enough historical candles for quant training: ${klines.length}`);
  }

  const quant = new QuantEngine({
    // V2 trainer records NET grid-episode returns. These values only remain
    // relevant for backward-compatible V1/raw observations.
    feeRate: 0.0004,
    syntheticSlippage: 0.0001,
    minSamples: 10
  });

  const trainer = new QuantTrainer({
    gridLevels: 3,
    gridSpacing: 100,
    baseOrderQty: 0.01,
    horizonCandles: 60,
    strideCandles: 15,
    warmupCandles: 120,
    makerFeeRate: 0.0002,
    syntheticSlippageRate: 0.0001
  });

  const observations = trainer.train(klines, quant);

  const model = quant.exportModel();
  const artifactsDir = path.join(process.cwd(), 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  const outputPath = path.join(
    artifactsDir,
    `quant_model_${symbol}.json`
  );

  fs.writeFileSync(outputPath, JSON.stringify(model));

  console.log(`QUANT_MODEL_WRITTEN ${outputPath}`);
  console.log(`QUANT_MODEL_VERSION ${model.version}`);
  console.log(`QUANT_TRAINER FIXED_HORIZON_VIRTUAL_GRID_V2`);
  console.log(`QUANT_OBSERVATIONS ${observations}`);
  console.log(`TRAINING_CANDLES ${klines.length}`);
  console.log(`HORIZON_CANDLES 60`);
  console.log(`STRIDE_CANDLES 15`);
}

main().catch(err => {
  console.error('QUANT_MODEL_TRAINING_FAILED', err);
  process.exit(1);
});
