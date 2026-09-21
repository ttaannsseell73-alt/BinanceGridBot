import {
  MicrostructureFeatures,
  PriceActionFeatures
} from '../models/strategy';

type CvdBucket = 'pos' | 'neg' | 'flat';
type ImbalanceBucket = 'high_buy' | 'high_sell' | 'neutral';
type OiBucket = 'pos' | 'neg' | 'flat';

function cvdBucket(value: MicrostructureFeatures['cvd']): CvdBucket | null {
  if (value === 'UNAVAILABLE_DUE_TO_DATA') return null;
  return value > 0 ? 'pos' : value < 0 ? 'neg' : 'flat';
}

function imbalanceBucket(
  value: MicrostructureFeatures['takerImbalance']
): ImbalanceBucket | null {
  if (value === 'UNAVAILABLE_DUE_TO_DATA') return null;
  return value > 1.5 ? 'high_buy' : value < 0.66 ? 'high_sell' : 'neutral';
}

function oiBucket(value: MicrostructureFeatures['oiDelta']): OiBucket | null {
  if (value === 'UNAVAILABLE_DUE_TO_DATA') return null;
  return value > 0 ? 'pos' : value < 0 ? 'neg' : 'flat';
}

function regimeFromParts(marketStructure: string, inRange: boolean): string | null {
  if (marketStructure === 'NONE') return null;
  if (inRange) return 'RANGE';
  if (marketStructure === 'HH' || marketStructure === 'HL') return 'UP';
  if (marketStructure === 'LH' || marketStructure === 'LL') return 'DOWN';
  return null;
}

function flowFromBuckets(cvd: CvdBucket, imbalance: ImbalanceBucket): string {
  if (imbalance === 'high_buy' || (imbalance === 'neutral' && cvd === 'pos')) {
    return 'BUY';
  }
  if (imbalance === 'high_sell' || (imbalance === 'neutral' && cvd === 'neg')) {
    return 'SELL';
  }
  return 'MIXED';
}

function oiRegime(bucket: OiBucket): 'BUILDING' | 'NOT_BUILDING' {
  return bucket === 'pos' ? 'BUILDING' : 'NOT_BUILDING';
}

export function buildBalancedFeatureHash(
  pa: PriceActionFeatures,
  ms: MicrostructureFeatures
): string | null {
  if (
    ms.cvd === 'UNAVAILABLE_DUE_TO_DATA' ||
    ms.takerImbalance === 'UNAVAILABLE_DUE_TO_DATA' ||
    ms.oiDelta === 'UNAVAILABLE_DUE_TO_DATA' ||
    ms.absorption === 'UNAVAILABLE_DUE_TO_DATA'
  ) {
    return null;
  }

  const regime = regimeFromParts(pa.marketStructure, pa.inRange);
  const cvd = cvdBucket(ms.cvd);
  const imbalance = imbalanceBucket(ms.takerImbalance);
  const oi = oiBucket(ms.oiDelta);

  if (!regime || !cvd || !imbalance || !oi) return null;

  return [
    `REG:${regime}`,
    `FLOW:${flowFromBuckets(cvd, imbalance)}`,
    `OI:${oiRegime(oi)}`,
    `BRK:${pa.breakoutUp || pa.breakoutDown ? 'YES' : 'NO'}`
  ].join('|');
}

export function buildBalancedFeatureHashFromExactHash(
  exactHash: string
): string | null {
  if (!exactHash || exactHash.includes('UNAVAILABLE')) return null;

  const parts = new Map<string, string>();
  for (const token of exactHash.split('|')) {
    const idx = token.indexOf(':');
    if (idx <= 0) continue;
    parts.set(token.slice(0, idx), token.slice(idx + 1));
  }

  const marketStructure = parts.get('MS');
  const inRangeRaw = parts.get('RNG');
  const cvd = parts.get('CVD') as CvdBucket | undefined;
  const imbalance = parts.get('IMB') as ImbalanceBucket | undefined;
  const oi = parts.get('OI') as OiBucket | undefined;
  const breakout =
    parts.get('B_UP') === 'true' ||
    parts.get('B_DN') === 'true';

  if (
    !marketStructure ||
    !inRangeRaw ||
    !cvd ||
    !imbalance ||
    !oi ||
    !['pos', 'neg', 'flat'].includes(cvd) ||
    !['high_buy', 'high_sell', 'neutral'].includes(imbalance) ||
    !['pos', 'neg', 'flat'].includes(oi)
  ) {
    return null;
  }

  const regime = regimeFromParts(marketStructure, inRangeRaw === 'true');
  if (!regime) return null;

  return [
    `REG:${regime}`,
    `FLOW:${flowFromBuckets(cvd, imbalance)}`,
    `OI:${oiRegime(oi)}`,
    `BRK:${breakout ? 'YES' : 'NO'}`
  ].join('|');
}
