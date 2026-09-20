/**
 * Fail-closed gate for live position state.
 *
 * A connected user stream alone is not enough to allow trading: the bot must
 * also have an absolute Binance position snapshot at least as new as every
 * observed fill mutation. This prevents a fill/account-update ordering race
 * from briefly exposing strategy decisions to stale inventory.
 */
export class UserRiskSyncState {
  private connected = false;
  private synchronized = false;
  private lastAbsolutePositionTime = 0;
  private latestMutationTime = 0;

  public onConnected(): void {
    this.connected = true;
    this.synchronized = false;
  }

  public onDisconnected(): void {
    this.connected = false;
    this.synchronized = false;
  }

  public onPositionMutation(eventTime: number): void {
    const safeTime = this.normalizeTime(eventTime);
    this.latestMutationTime = Math.max(this.latestMutationTime, safeTime);

    if (this.latestMutationTime > this.lastAbsolutePositionTime) {
      this.synchronized = false;
    }
  }

  public onAbsolutePosition(eventTime: number): void {
    const safeTime = this.normalizeTime(eventTime);
    this.lastAbsolutePositionTime = Math.max(
      this.lastAbsolutePositionTime,
      safeTime
    );

    this.synchronized =
      this.connected &&
      this.lastAbsolutePositionTime >= this.latestMutationTime;
  }

  /**
   * A REST snapshot started after every known mutation is authoritative for
   * those mutations. A mutation observed after the request started keeps the
   * gate closed until a newer absolute snapshot arrives.
   */
  public onRestSnapshot(
    requestStartedAt: number,
    requestCompletedAt: number
  ): void {
    const startedAt = this.normalizeTime(requestStartedAt);
    const completedAt = this.normalizeTime(requestCompletedAt);

    if (this.latestMutationTime <= startedAt) {
      this.lastAbsolutePositionTime = Math.max(
        this.lastAbsolutePositionTime,
        completedAt
      );
      this.synchronized = this.connected;
    } else {
      this.synchronized = false;
    }
  }

  public isReady(): boolean {
    return this.connected && this.synchronized;
  }

  public getState(): {
    connected: boolean;
    synchronized: boolean;
    lastAbsolutePositionTime: number;
    latestMutationTime: number;
  } {
    return {
      connected: this.connected,
      synchronized: this.synchronized,
      lastAbsolutePositionTime: this.lastAbsolutePositionTime,
      latestMutationTime: this.latestMutationTime
    };
  }

  private normalizeTime(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : Date.now();
  }
}
