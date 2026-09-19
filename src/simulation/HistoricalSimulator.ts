import { Candle, MicrostructureFeatures, PriceActionFeatures, QuantScore } from '../models/strategy';
import { StrategyEngine, StrategyConfig } from '../strategy/StrategyEngine';
import { PriceActionEngine } from '../strategy/PriceActionEngine';
import { MicrostructureEngine } from '../strategy/MicrostructureEngine';
import { QuantEngine } from '../strategy/QuantEngine';
import { LifecycleState } from '../models/types';
import { TradeResult, SimulationReport, MetricsEngine } from './MetricsEngine';

import { FakeBinanceExchange } from '../tests/FakeBinanceExchange';
import { FakeBinanceClient } from '../tests/FakeBinanceClient';
import { ExecutionEngine } from '../engine/ExecutionEngine';
import { IntentJournal } from '../db/IntentJournal';
import { RiskGuard } from '../engine/RiskGuard';
import { OrderTracker } from '../engine/OrderTracker';

interface QuantSnapshot {
  pa: PriceActionFeatures;
  ms: MicrostructureFeatures;
  entryPrice: number;
  entryTime: number;
}

export class HistoricalSimulator {
  private strategyEngine: StrategyEngine;
  private paEngine: PriceActionEngine;
  private msEngine: MicrostructureEngine;
  private quantEngine: QuantEngine;
  private metricsEngine: MetricsEngine;

  private exchange: FakeBinanceExchange;
  private client: FakeBinanceClient;
  private executionEngine: ExecutionEngine;
  private journal: IntentJournal;
  private riskGuard: RiskGuard;
  private tracker: OrderTracker;

  private trades: TradeResult[] = [];

  private activePA: PriceActionFeatures | null = null;
  private activeMS: MicrostructureFeatures | null = null;

  private initialCapital: number;
  private slippageBps: number;
  private feeBps: number;

  private recordQuantObservations = false;
  private currentSimulationTime = 0;
  private quantSnapshots = new Map<string, QuantSnapshot>();

  constructor(
    config: StrategyConfig,
    initialCapital: number = 10000,
    slippageBps: number = 1,
    feeBps: number = 2,
    quantEngine?: QuantEngine
  ) {
    this.strategyEngine = new StrategyEngine(config);
    this.paEngine = new PriceActionEngine();
    this.msEngine = new MicrostructureEngine(60000);

    this.quantEngine = quantEngine ?? new QuantEngine({
      feeRate: 0.0004,
      syntheticSlippage: 0.0001,
      minSamples: config.minSamples
    });

    this.metricsEngine = new MetricsEngine();
    this.initialCapital = initialCapital;
    this.slippageBps = slippageBps;
    this.feeBps = feeBps;

    this.exchange = new FakeBinanceExchange();
    this.client = new FakeBinanceClient(this.exchange);
    this.journal = new IntentJournal(':memory:');
    this.riskGuard = new RiskGuard(this.journal, 10, 10, 100000);
    this.tracker = new OrderTracker(this.journal, this.riskGuard);
    this.executionEngine = new ExecutionEngine(this.client, this.journal);

    this.exchange.on('message', (msg: string) => {
      this.tracker.handleTradeUpdate(JSON.parse(msg));
      this.extractFillsFromJournal();
    });
  }

  public getQuantEngine(): QuantEngine {
    return this.quantEngine;
  }

  private clonePA(pa: PriceActionFeatures): PriceActionFeatures {
    return {
      ...pa,
      swingHighs: pa.swingHighs.map(x => ({ ...x })),
      swingLows: pa.swingLows.map(x => ({ ...x }))
    };
  }

  private cloneMS(ms: MicrostructureFeatures): MicrostructureFeatures {
    return { ...ms };
  }

  private extractFillsFromJournal(): void {
    const allIntents = this.journal.getAllIntents();

    for (const intent of allIntents) {
      if (intent.state !== LifecycleState.CONFIRMED_FILLED) {
        continue;
      }

      const exists = this.trades.find(
        t => t.clientOrderId === intent.clientOrderId
      );

      if (exists) {
        continue;
      }

      const fees =
        (intent.price * intent.originalQuantity) *
        (this.feeBps / 10000);

      const slippage =
        (intent.price * intent.originalQuantity) *
        (this.slippageBps / 10000);

      let pnl = 0;

      const position = this.riskGuard.getCurrentPosition();

      if (
        (intent.side === 'SELL' && position >= 0) ||
        (intent.side === 'BUY' && position <= 0)
      ) {
        pnl =
          this.strategyEngine['config'].gridSpacing *
          intent.originalQuantity;
      }

      const netPnl = pnl - fees - slippage;
      const snapshot = this.quantSnapshots.get(intent.clientOrderId);

      this.trades.push({
        clientOrderId: intent.clientOrderId,
        side: intent.side,
        entryPrice: intent.price,
        exitPrice: intent.price,
        quantity: intent.originalQuantity,
        pnl,
        fees,
        slippage,
        netPnl,
        entryTime: snapshot?.entryTime ?? intent.createdAt,
        exitTime: this.currentSimulationTime || Date.now(),
        regime:
          snapshot?.pa.marketStructure ??
          this.activePA?.marketStructure ??
          'NONE',
        featuresHash:
          `${snapshot?.pa.marketStructure ?? this.activePA?.marketStructure ?? 'NONE'}_` +
          `${snapshot?.ms.absorption ?? this.activeMS?.absorption ?? 'UNAVAILABLE'}`
      });

      /*
       * IMPORTANT:
       * QuantEngine expects RAW forward return.
       * Fees/slippage are deducted later inside QuantEngine.evaluate().
       *
       * Therefore pnl/notional is deliberately used here instead of netPnl.
       */
      if (this.recordQuantObservations && snapshot) {
        const notional =
          Math.abs(intent.price * intent.originalQuantity);

        const forwardReturn =
          notional > 0 ? pnl / notional : 0;

        const holdingTimeMs =
          Math.max(
            0,
            this.currentSimulationTime - snapshot.entryTime
          );

        this.quantEngine.recordObservation(
          snapshot.pa,
          snapshot.ms,
          forwardReturn,
          holdingTimeMs
        );
      }

      this.quantSnapshots.delete(intent.clientOrderId);
    }
  }

  public async run(
    klines: Candle[],
    isOutofSample: boolean = false,
    featureMask?: { pa?: string[]; ms?: string[] }
  ): Promise<SimulationReport> {
    this.trades = [];
    this.quantSnapshots.clear();

    /*
     * IS = exploration/training.
     * OOS = frozen quant model, evaluate only.
     */
    this.recordQuantObservations = !isOutofSample;

    for (const candle of klines) {
      this.currentSimulationTime = candle.timestamp;

      /*
       * Existing resting orders execute against the new candle BEFORE
       * this candle's features are exposed to the strategy.
       * This preserves no-lookahead execution.
       */
      this.exchange.simulateCandle(
        candle,
        this.slippageBps,
        this.feeBps
      );

      await new Promise(r => setImmediate(r));

      this.activePA = this.paEngine.processCandle(candle);

      /*
       * Historical kline data does not contain true trade-level
       * microstructure or OI. Never fabricate it.
       */
      this.activeMS = {
        cvd: 'UNAVAILABLE_DUE_TO_DATA',
        takerImbalance: 'UNAVAILABLE_DUE_TO_DATA',
        oiDelta: 'UNAVAILABLE_DUE_TO_DATA',
        absorption: 'UNAVAILABLE_DUE_TO_DATA'
      };

      let evalPA = this.activePA;
      let evalMS = this.activeMS;

      if (featureMask) {
        if (featureMask.pa) {
          evalPA = { ...evalPA };

          for (const key of featureMask.pa) {
            (evalPA as any)[key] = null;
          }
        }

        if (featureMask.ms) {
          evalMS = { ...evalMS };

          for (const key of featureMask.ms) {
            (evalMS as any)[key] = null;
          }
        }
      }

      const learnedScore =
        this.quantEngine.evaluate(evalPA, evalMS);

      /*
       * IS must explore even before QuantEngine has observations,
       * otherwise we get the bootstrap deadlock:
       *
       * no observations -> no score -> no grid -> no observations.
       *
       * This synthetic score exists ONLY inside historical IS training.
       * It is never used for OOS or live trading.
       */
      const explorationScore: QuantScore = {
        sampleCount: Number.MAX_SAFE_INTEGER,
        hitRate: 1,
        expectancy: 1,
        averageWin: 1,
        averageLoss: 0,
        mae: 0,
        mfe: 1
      };

      const strategyScore =
        isOutofSample ? learnedScore : explorationScore;

      const activeIntents =
        this.journal.getAllIntents().filter(i =>
          i.state !== LifecycleState.CONFIRMED_FILLED &&
          i.state !== LifecycleState.CONFIRMED_CANCELED &&
          i.state !== LifecycleState.CONFIRMED_REJECTED
        );

      if (
        activeIntents.length === 0 &&
        candle.isClosed
      ) {
        const intents =
          this.strategyEngine.generateGrid(
            candle.close,
            evalPA,
            this.riskGuard.getCurrentPosition(),
            strategyScore
          );

        for (const intent of intents) {
          if (!this.riskGuard.reserveAndSaveIntent(intent)) {
            continue;
          }

          /*
           * Snapshot features at DECISION TIME.
           * Future fill-time features must never relabel the decision.
           */
          if (!isOutofSample) {
            this.quantSnapshots.set(
              intent.clientOrderId,
              {
                pa: this.clonePA(evalPA),
                ms: this.cloneMS(evalMS),
                entryPrice: candle.close,
                entryTime: candle.timestamp
              }
            );
          }

          await this.executionEngine.submitOrder(intent);
        }
      }
    }

    /*
     * Flush any WS updates queued by the final candle.
     */
    await new Promise(r => setImmediate(r));

    return this.metricsEngine.calculateReport(
      this.trades,
      this.initialCapital
    );
  }
}
