import path from 'path';
import { config } from '../config';
import { analyzeQuantReadiness } from '../simulation/QuantReadiness';
import { QuantModelStore } from '../simulation/QuantModelStore';
import { getQuantRiskProfile } from '../strategy/QuantRiskProfile';

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

const profile = getQuantRiskProfile(config.QUANT_EXECUTION_MODE);

const report = analyzeQuantReadiness(candidate.model, {
  minSamples: profile.minSamples,
  minExpectancy: profile.minExpectancy,
  rawRoundTripPenalty: (0.0004 * 2) + (0.0001 * 2),
  stateMode: profile.matchMode
});

console.log('QUANT_READINESS_MODEL', candidate.modelPath);
console.log('QUANT_RISK_PROFILE', profile.name);
console.log('QUANT_STATE_MODE', report.stateMode);
console.log('MIN_SAMPLES', report.minSamples);
console.log('MIN_EXPECTANCY', report.minExpectancy);
console.log('QUANT_READINESS_SOURCE', candidate.source);
console.log('TOTAL_OBSERVATIONS', report.totalObservations);
console.log('LIVE_EXACT_OBSERVATIONS', report.liveExactObservations);
console.log('LIVE_EXACT_STATES', report.liveExactStates);
console.log('EXECUTABLE_STATES', report.executableStates);
console.log('READINESS', report.executableStates > 0 ? 'CANDIDATE_FOUND' : 'NOT_READY');

for (const state of report.states.slice(0, 20)) {
  console.log(JSON.stringify(state));
}
