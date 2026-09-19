import path from 'path';
import { config } from '../config';
import { analyzeQuantReadiness } from '../simulation/QuantReadiness';
import { QuantModelStore } from '../simulation/QuantModelStore';

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

const store = new QuantModelStore(runtimePath, basePath);
const candidate = store.loadCandidates()[0];

if (!candidate) {
  throw new Error(
    `No readable Quant model found at runtime/backup/base paths`
  );
}

const report = analyzeQuantReadiness(candidate.model, {
  minSamples: 10,
  minExpectancy: 0.001,
  rawRoundTripPenalty: (0.0004 * 2) + (0.0001 * 2)
});

console.log('QUANT_READINESS_MODEL', candidate.modelPath);
console.log('QUANT_READINESS_SOURCE', candidate.source);
console.log('TOTAL_OBSERVATIONS', report.totalObservations);
console.log('LIVE_EXACT_OBSERVATIONS', report.liveExactObservations);
console.log('LIVE_EXACT_STATES', report.liveExactStates);
console.log('EXECUTABLE_STATES', report.executableStates);
console.log('READINESS', report.executableStates > 0 ? 'CANDIDATE_FOUND' : 'NOT_READY');

for (const state of report.states.slice(0, 20)) {
  console.log(JSON.stringify(state));
}
