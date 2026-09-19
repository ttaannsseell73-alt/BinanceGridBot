import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { analyzeQuantReadiness } from '../simulation/QuantReadiness';
import { QuantModel } from '../strategy/QuantEngine';

const runtimePath = path.join(
  process.cwd(),
  'data',
  `quant_model_${config.SYMBOL}.live.json`
);
const basePath = path.join(
  process.cwd(),
  'artifacts',
  `quant_model_${config.SYMBOL}.json`
);

const modelPath = fs.existsSync(runtimePath) ? runtimePath : basePath;

if (!fs.existsSync(modelPath)) {
  throw new Error(`Quant model not found: ${modelPath}`);
}

const model = JSON.parse(fs.readFileSync(modelPath, 'utf8')) as QuantModel;

const report = analyzeQuantReadiness(model, {
  minSamples: 10,
  minExpectancy: 0.001,
  rawRoundTripPenalty: (0.0004 * 2) + (0.0001 * 2)
});

console.log('QUANT_READINESS_MODEL', modelPath);
console.log('TOTAL_OBSERVATIONS', report.totalObservations);
console.log('LIVE_EXACT_OBSERVATIONS', report.liveExactObservations);
console.log('LIVE_EXACT_STATES', report.liveExactStates);
console.log('EXECUTABLE_STATES', report.executableStates);
console.log('READINESS', report.executableStates > 0 ? 'CANDIDATE_FOUND' : 'NOT_READY');

for (const state of report.states.slice(0, 20)) {
  console.log(JSON.stringify(state));
}
