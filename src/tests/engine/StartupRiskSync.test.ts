import { describe, expect, it } from 'vitest';
import { IntentJournal } from '../../db/IntentJournal';
import { RiskGuard } from '../../engine/RiskGuard';
import { syncStartupRiskState } from '../../engine/StartupRiskSync';
import { FakeBinanceClient } from '../FakeBinanceClient';
import { FakeBinanceExchange } from '../FakeBinanceExchange';

describe('startup risk synchronization', () => {
  it('hydrates RiskGuard from the exchange position before trading', async () => {
    const exchange = new FakeBinanceExchange();
    exchange.positionAmount = 0.25;

    const client = new FakeBinanceClient(exchange);
    const journal = new IntentJournal(':memory:');
    const risk = new RiskGuard(journal, 1, 1, 100000);

    const amount = await syncStartupRiskState(client, risk, 'BTCUSDT');

    expect(amount).toBe(0.25);
    expect(risk.getCurrentPosition()).toBe(0.25);
  });

  it('fails closed in hedge mode', async () => {
    const exchange = new FakeBinanceExchange();
    exchange.hedgeMode = true;

    const client = new FakeBinanceClient(exchange);
    const journal = new IntentJournal(':memory:');
    const risk = new RiskGuard(journal, 1, 1, 100000);

    await expect(
      syncStartupRiskState(client, risk, 'BTCUSDT')
    ).rejects.toThrow(/Hedge Mode/i);

    expect(risk.getCurrentPosition()).toBe(0);
  });

  it('fails closed when account-state REST calls fail', async () => {
    const exchange = new FakeBinanceExchange();
    exchange.simulateRestTimeout = true;

    const client = new FakeBinanceClient(exchange);
    const journal = new IntentJournal(':memory:');
    const risk = new RiskGuard(journal, 1, 1, 100000);

    await expect(
      syncStartupRiskState(client, risk, 'BTCUSDT')
    ).rejects.toThrow(/Timeout/);
  });
});
