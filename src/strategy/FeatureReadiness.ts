import {
  MicrostructureFeatures,
  PriceActionFeatures
} from '../models/strategy';

export function isMaturePriceAction(
  pa: PriceActionFeatures | null
): pa is PriceActionFeatures {
  return Boolean(pa && pa.marketStructure !== 'NONE');
}

export function isCompleteMicrostructure(
  ms: MicrostructureFeatures | null
): ms is MicrostructureFeatures {
  return Boolean(
    ms &&
    ms.cvd !== 'UNAVAILABLE_DUE_TO_DATA' &&
    ms.takerImbalance !== 'UNAVAILABLE_DUE_TO_DATA' &&
    ms.oiDelta !== 'UNAVAILABLE_DUE_TO_DATA' &&
    ms.absorption !== 'UNAVAILABLE_DUE_TO_DATA'
  );
}

export function areLiveQuantFeaturesReady(
  pa: PriceActionFeatures | null,
  ms: MicrostructureFeatures | null
): boolean {
  return isMaturePriceAction(pa) && isCompleteMicrostructure(ms);
}
