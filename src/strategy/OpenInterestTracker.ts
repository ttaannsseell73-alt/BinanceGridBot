export type OiDelta = number | 'UNAVAILABLE_DUE_TO_DATA';

/**
 * Tracks consecutive open-interest snapshots and exposes a normalized delta.
 * Repeated snapshots with the same exchange timestamp are ignored so a fresh
 * non-zero delta is not immediately overwritten by a duplicate poll.
 */
export class OpenInterestTracker {
  private previousOpenInterest: number | null = null;
  private lastDelta: OiDelta = 'UNAVAILABLE_DUE_TO_DATA';
  private lastSnapshotTime: number | null = null;

  public update(openInterest: number, snapshotTime?: number): OiDelta {
    if (!Number.isFinite(openInterest) || openInterest <= 0) {
      return this.lastDelta;
    }

    if (
      snapshotTime !== undefined &&
      Number.isFinite(snapshotTime) &&
      this.lastSnapshotTime !== null &&
      snapshotTime <= this.lastSnapshotTime
    ) {
      return this.lastDelta;
    }

    if (snapshotTime !== undefined && Number.isFinite(snapshotTime)) {
      this.lastSnapshotTime = snapshotTime;
    }

    if (this.previousOpenInterest === null) {
      this.previousOpenInterest = openInterest;
      this.lastDelta = 'UNAVAILABLE_DUE_TO_DATA';
      return this.lastDelta;
    }

    const previous = this.previousOpenInterest;
    this.previousOpenInterest = openInterest;

    if (previous <= 0) {
      this.lastDelta = 'UNAVAILABLE_DUE_TO_DATA';
      return this.lastDelta;
    }

    this.lastDelta = (openInterest - previous) / previous;
    return this.lastDelta;
  }

  public getDelta(): OiDelta {
    return this.lastDelta;
  }

  public getPreviousOpenInterest(): number | null {
    return this.previousOpenInterest;
  }

  public getLastSnapshotTime(): number | null {
    return this.lastSnapshotTime;
  }
}
