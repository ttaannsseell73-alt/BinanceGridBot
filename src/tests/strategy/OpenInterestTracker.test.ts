import { describe, it, expect } from 'vitest';
import { OpenInterestTracker } from '../../strategy/OpenInterestTracker';

describe('OpenInterestTracker', () => {
  it('returns unavailable on the first valid snapshot', () => {
    const tracker = new OpenInterestTracker();
    expect(tracker.update(1000, 100)).toBe('UNAVAILABLE_DUE_TO_DATA');
  });

  it('returns normalized positive and negative deltas', () => {
    const tracker = new OpenInterestTracker();
    tracker.update(1000, 100);
    expect(tracker.update(1100, 200)).toBeCloseTo(0.1, 10);
    expect(tracker.update(990, 300)).toBeCloseTo(-0.1, 10);
  });

  it('ignores invalid snapshots without destroying the last valid delta', () => {
    const tracker = new OpenInterestTracker();
    tracker.update(1000, 100);
    const delta = tracker.update(1050, 200);
    expect(tracker.update(0, 300)).toBe(delta);
    expect(tracker.getPreviousOpenInterest()).toBe(1050);
  });

  it('ignores duplicate exchange snapshots without zeroing the last fresh delta', () => {
    const tracker = new OpenInterestTracker();
    tracker.update(1000, 100);
    const freshDelta = tracker.update(1100, 200);

    expect(freshDelta).toBeCloseTo(0.1, 10);
    expect(tracker.update(1100, 200)).toBe(freshDelta);
    expect(tracker.getPreviousOpenInterest()).toBe(1100);
    expect(tracker.getLastSnapshotTime()).toBe(200);
  });

  it('accepts a true zero delta when the exchange timestamp advances', () => {
    const tracker = new OpenInterestTracker();
    tracker.update(1000, 100);
    expect(tracker.update(1000, 200)).toBe(0);
    expect(tracker.getLastSnapshotTime()).toBe(200);
  });
});
