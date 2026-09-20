import { describe, expect, it } from 'vitest';
import { UserRiskSyncState } from '../../engine/UserRiskSyncState';

describe('UserRiskSyncState', () => {
  it('requires both a connected stream and a fresh absolute position', () => {
    const state = new UserRiskSyncState();

    expect(state.isReady()).toBe(false);

    state.onConnected();
    expect(state.isReady()).toBe(false);

    state.onAbsolutePosition(100);
    expect(state.isReady()).toBe(true);

    state.onDisconnected();
    expect(state.isReady()).toBe(false);
  });

  it('closes the gate on a newer fill until absolute state catches up', () => {
    const state = new UserRiskSyncState();

    state.onConnected();
    state.onAbsolutePosition(100);
    state.onPositionMutation(110);
    expect(state.isReady()).toBe(false);

    state.onAbsolutePosition(109);
    expect(state.isReady()).toBe(false);

    state.onAbsolutePosition(110);
    expect(state.isReady()).toBe(true);
  });

  it('does not become stale when an older fill event arrives after newer absolute state', () => {
    const state = new UserRiskSyncState();

    state.onConnected();
    state.onAbsolutePosition(200);
    state.onPositionMutation(150);

    expect(state.isReady()).toBe(true);
  });

  it('accepts a REST snapshot only when it started after every known mutation', () => {
    const state = new UserRiskSyncState();

    state.onConnected();
    state.onPositionMutation(120);

    state.onRestSnapshot(110, 130);
    expect(state.isReady()).toBe(false);

    state.onRestSnapshot(121, 140);
    expect(state.isReady()).toBe(true);
  });
});
