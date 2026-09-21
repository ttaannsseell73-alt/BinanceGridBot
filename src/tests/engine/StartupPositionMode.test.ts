import { describe, expect, it } from 'vitest';
import { ensureStartupPositionMode } from '../../engine/StartupPositionMode';
import { FakeBinanceClient } from '../FakeBinanceClient';
import { FakeBinanceExchange } from '../FakeBinanceExchange';

describe('StartupPositionMode', () => {
  it('keeps ONE_WAY unchanged', async () => {
    const exchange = new FakeBinanceExchange();
    const client = new FakeBinanceClient(exchange);

    await expect(
      ensureStartupPositionMode(client, true)
    ).resolves.toBe('ONE_WAY');

    expect(exchange.hedgeMode).toBe(false);
  });

  it('auto-fixes HEDGE to ONE_WAY only when explicitly allowed', async () => {
    const exchange = new FakeBinanceExchange();
    exchange.hedgeMode = true;
    const client = new FakeBinanceClient(exchange);

    await expect(
      ensureStartupPositionMode(client, true)
    ).resolves.toBe('ONE_WAY');

    expect(exchange.hedgeMode).toBe(false);
  });

  it('fails closed instead of changing HEDGE when auto-fix is not allowed', async () => {
    const exchange = new FakeBinanceExchange();
    exchange.hedgeMode = true;
    const client = new FakeBinanceClient(exchange);

    await expect(
      ensureStartupPositionMode(client, false)
    ).rejects.toThrow(/requires ONE_WAY/i);

    expect(exchange.hedgeMode).toBe(true);
  });

  it('fails closed if the TESTNET position-mode change cannot be verified', async () => {
    const exchange = new FakeBinanceExchange();
    exchange.hedgeMode = true;

    class NonChangingClient extends FakeBinanceClient {
      async setPositionMode(): Promise<void> {
        // Simulates an exchange acknowledgement that does not actually change state.
      }
    }

    const client = new NonChangingClient(exchange);

    await expect(
      ensureStartupPositionMode(client, true)
    ).rejects.toThrow(/verification failed/i);
  });
});
