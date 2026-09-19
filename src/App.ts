import path from 'path';
import { PriceActionEngine } from './strategy/PriceActionEngine';
import { MicrostructureEngine } from './strategy/MicrostructureEngine';
import { Candle, Tick, PriceActionFeatures, MicrostructureFeatures, QuantScore } from './models/strategy';
import { config } from './config';
import { logger } from './utils/logger';
import { IntentJournal } from './db/IntentJournal';
import { RiskGuard } from './engine/RiskGuard';
import { BinanceRestClient } from './gateways/BinanceRestClient';
import { BinanceMarketGateway } from './gateways/BinanceMarketGateway';
import { BinanceUserGateway } from './gateways/BinanceUserGateway';
import { ExecutionEngine } from './engine/ExecutionEngine';
import { OrderTracker } from './engine/OrderTracker';
import { Reconciler } from './engine/Reconciler';
import { StrategyEngine } from './strategy/StrategyEngine';
import { Watchdog } from './engine/Watchdog';
import { LifecycleState } from './models/types';
import { OpenInterestTracker, OiDelta } from './strategy/OpenInterestTracker';
import { QuantEngine } from './strategy/QuantEngine';
import { assertExchangeEnvironmentSafe } from './config/exchangeSafety';
import { syncStartupRiskState } from './engine/StartupRiskSync';
import { ensureStartupSymbolRiskConfig } from './engine/StartupSymbolConfig';
import { EmergencyReason, EmergencyRiskEngine } from './engine/EmergencyRiskEngine';
import { executeEmergencyExit } from './engine/EmergencyExitEngine';
import { assertQuantExecutionModeSafe, resolveQuantExecution } from './strategy/QuantExecutionPolicy';
import { LiveQuantObserver, LiveQuantObservationEvent } from './simulation/LiveQuantObserver';
import { QuantModelStore } from './simulation/QuantModelStore';
import { sanitizeShadowStartup } from './engine/ShadowStartupCleanup';
import { getRuntimePollingIntervals } from './config/RuntimePollingPolicy';

export class App {
  private journal: IntentJournal;
  private riskGuard: RiskGuard;
  private restClient: BinanceRestClient;
  private marketGateway: BinanceMarketGateway;
  private userGateway: BinanceUserGateway;
  private executionEngine: ExecutionEngine;
  private orderTracker: OrderTracker;
  private reconciler: Reconciler;
  private strategyEngine: StrategyEngine;
  private watchdog: Watchdog;

  private strategyInterval: NodeJS.Timeout | null = null;
  private reconciliationInterval: NodeJS.Timeout | null = null;
  private openInterestInterval: NodeJS.Timeout | null = null;
  private positionRiskInterval: NodeJS.Timeout | null = null;

  private readonly gridSpacing = 100;
  private readonly gridRecenterThreshold = 100;
  private gridAnchorPrice: number | null = null;
  private pendingGridAnchorPrice: number | null = null;

  private priceActionEngine = new PriceActionEngine();
  private microstructureEngine = new MicrostructureEngine(60000);
  private activePA: PriceActionFeatures | null = null;
  private activeMS: MicrostructureFeatures | null = null;
  private aggTradeCount = 0;
  private openInterestTracker = new OpenInterestTracker();
  private currentOiDelta: OiDelta = 'UNAVAILABLE_DUE_TO_DATA';
  private emergencyExitInProgress = false;
  private emergencyRiskEngine = new EmergencyRiskEngine({
    maxAdverseMovePct: 0.03,
    minLiquidationDistancePct: 0.05,
    maxConsecutiveCriticalErrors: 10
  });
  private quantEngine = new QuantEngine({
    feeRate: 0.0004,
    syntheticSlippage: 0.0001,
    minSamples: 10
  });
  private quantModelLoaded = false;
  private readonly quantExecutionMode = config.QUANT_EXECUTION_MODE;
  private readonly quantBaseModelPath = path.join(
    process.cwd(),
    'artifacts',
    `quant_model_${config.SYMBOL}.json`
  );
  private readonly quantRuntimeModelPath = path.join(
    process.cwd(),
    'data',
    `quant_model_${config.SYMBOL}.live.json`
  );
  private readonly quantModelStore = new QuantModelStore(
    this.quantRuntimeModelPath,
    this.quantBaseModelPath
  );
  private liveQuantObserver: LiveQuantObserver;
  constructor() {
    assertExchangeEnvironmentSafe({
      restUrl: config.BINANCE_FUTURES_URL,
      wsUrl: config.BINANCE_FUTURES_WS_URL,
      liveAcknowledgement: process.env.I_UNDERSTAND_LIVE
    });

    assertQuantExecutionModeSafe({
      mode: this.quantExecutionMode,
      restUrl: config.BINANCE_FUTURES_URL,
      wsUrl: config.BINANCE_FUTURES_WS_URL,
      liveQuantAcknowledgement: config.I_UNDERSTAND_QUANT_LIVE
    });

    this.journal = new IntentJournal(config.DB_PATH);
    this.riskGuard = new RiskGuard(
      this.journal,
      config.MAX_LONG_EXPOSURE,
      config.MAX_SHORT_EXPOSURE,
      config.MAX_TOTAL_NOTIONAL
    );
    this.restClient = new BinanceRestClient(
      config.BINANCE_FUTURES_URL,
      config.BINANCE_API_KEY,
      config.BINANCE_API_SECRET
    );
    this.marketGateway = new BinanceMarketGateway(config.BINANCE_FUTURES_WS_URL, config.SYMBOL);
    this.userGateway = new BinanceUserGateway(
      config.BINANCE_FUTURES_URL,
      config.BINANCE_FUTURES_WS_URL,
      config.BINANCE_API_KEY
    );
    this.executionEngine = new ExecutionEngine(this.restClient, this.journal);
    this.orderTracker = new OrderTracker(this.journal, this.riskGuard);
    this.reconciler = new Reconciler(this.restClient, this.journal, config.SYMBOL);
    
    // Very simple grid config
    this.strategyEngine = new StrategyEngine({
      symbol: config.SYMBOL,
      gridLevels: 3,
      gridSpacing: this.gridSpacing, // example 100 USDT
      baseOrderQty: 0.01,
      skewFactor: 0.5,
      minExpectancy: 0.0010,
      minSamples: 10,
      safetyMultiplier: 1.5,
      expectedCostBps: 0.0018
    });
    
    this.watchdog = new Watchdog();
    this.loadQuantModel();
    this.liveQuantObserver = new LiveQuantObserver(
      {
        gridLevels: 3,
        gridSpacing: this.gridSpacing,
        baseOrderQty: 0.01,
        horizonCandles: 60,
        strideCandles: 15,
        makerFeeRate: 0.0002,
        syntheticSlippageRate: 0.0001
      },
      this.quantEngine,
      (event) => this.onLiveQuantObservation(event)
    );
    this.setupEvents();
  }

  private loadQuantModel(): void {
    const candidates = this.quantModelStore.loadCandidates();

    for (const candidate of candidates) {
      try {
        const observations = this.quantEngine.importModel(candidate.model);

        if (observations <= 0) {
          logger.warn({
            modelPath: candidate.modelPath,
            source: candidate.source
          }, 'Quant model candidate contained no usable observations');
          continue;
        }

        this.quantModelLoaded = true;
        logger.info({
          modelPath: candidate.modelPath,
          source: candidate.source,
          observations,
          quantExecutionMode: this.quantExecutionMode
        }, 'Quant model loaded');
        return;
      } catch (err) {
        logger.error({
          err,
          modelPath: candidate.modelPath,
          source: candidate.source
        }, 'Failed to import Quant model candidate');
      }
    }

    this.quantModelLoaded = false;
    logger.warn({
      baseModelPath: this.quantBaseModelPath,
      runtimeModelPath: this.quantRuntimeModelPath,
      quantExecutionMode: this.quantExecutionMode
    }, 'No usable Quant model found; real Quant execution will fail closed');
  }

  private persistRuntimeQuantModel(): void {
    this.quantModelStore.saveRuntime(this.quantEngine.exportModel());
    this.quantModelLoaded = this.quantEngine.getObservationCount() > 0;
  }

  private onLiveQuantObservation(event: LiveQuantObservationEvent): void {
    if (this.quantExecutionMode !== 'SHADOW') return;

    try {
      this.persistRuntimeQuantModel();
      logger.info({
        symbol: config.SYMBOL,
        anchorTimestamp: event.anchorTimestamp,
        completedTimestamp: event.completedTimestamp,
        netReturn: event.outcome.netReturn,
        filledOrders: event.outcome.filledOrders,
        terminalPosition: event.outcome.terminalPosition,
        totalLiveRecorded: event.totalRecorded,
        pendingEpisodes: event.pendingEpisodes,
        totalModelObservations: this.quantEngine.getObservationCount(),
        runtimeModelPath: this.quantRuntimeModelPath
      }, 'Live Quant observation recorded');
    } catch (err) {
      logger.error({
        err,
        runtimeModelPath: this.quantRuntimeModelPath
      }, 'Failed to persist live Quant observation');
    }
  }

  private getRealQuantScore(): QuantScore | null {
    if (!this.quantModelLoaded || !this.activePA || !this.activeMS) {
      return null;
    }

    return this.quantEngine.evaluate(this.activePA, this.activeMS);
  }

  private async warmStartPriceAction(): Promise<void> {
    try {
      // PriceActionEngine needs enough closed 1m history to establish
      // multiple swing highs/lows. 100 candles was empirically too short and
      // left live startup at MS:NONE/RNG:false, which could not match the
      // trained PA model. Binance futures klines supports this bounded depth.
      const candles = await this.restClient.getRecentKlines(
        config.SYMBOL,
        '1m',
        1000
      );

      let latest: PriceActionFeatures | null = null;
      for (const candle of candles) {
        latest = this.priceActionEngine.processCandle(candle);
      }

      this.activePA = latest;

      if (latest) {
        logger.info({
          symbol: config.SYMBOL,
          candles: candles.length,
          marketStructure: latest.marketStructure,
          inRange: latest.inRange,
          breakoutUp: latest.breakoutUp,
          breakoutDown: latest.breakoutDown,
          liquiditySweepUp: latest.liquiditySweepUp,
          liquiditySweepDown: latest.liquiditySweepDown
        }, 'Price action warm-start complete');
      } else {
        logger.warn({ symbol: config.SYMBOL }, 'Price action warm-start returned no closed candles');
      }
    } catch (err) {
      this.activePA = null;
      logger.warn({ err, symbol: config.SYMBOL }, 'Price action warm-start failed; waiting for live candles');
    }
  }

  private setupEvents() {
    this.marketGateway.on('price_update', () => {
      this.watchdog.pingMarket();
    });

    this.marketGateway.on('kline_close', (candle: Candle) => {
      this.activePA = this.priceActionEngine.processCandle(candle);

      logger.info({
        candleTimestamp: candle.timestamp,
        close: candle.close,
        marketStructure: this.activePA.marketStructure,
        inRange: this.activePA.inRange,
        breakoutUp: this.activePA.breakoutUp,
        breakoutDown: this.activePA.breakoutDown,
        liquiditySweepUp: this.activePA.liquiditySweepUp,
        liquiditySweepDown: this.activePA.liquiditySweepDown
      }, 'Live price action updated');

      if (this.quantExecutionMode === 'SHADOW') {
        this.liveQuantObserver.processClosedCandle(
          candle,
          this.activePA,
          this.activeMS
        );
      }
    });

    this.marketGateway.on('agg_trade', (tick: Tick) => {
      const calculated =
        this.microstructureEngine.processTick(
          tick,
          this.currentOiDelta
        );

      this.activeMS = calculated;

      this.aggTradeCount++;

      if (this.aggTradeCount === 1) {
        logger.info({
          tick,
          microstructure: this.activeMS
        }, 'Live microstructure initialized (OI pending)');
      }
    });

    this.userGateway.on('order_trade_update', (payload) => {
      this.watchdog.pingUser();
      this.orderTracker.handleTradeUpdate(payload);
    });

    this.watchdog.on(
      'stale_market',
      () => this.shutdown('Stale market data')
    );

    this.watchdog.on(
      'stale_user',
      () => this.shutdown('Stale user stream')
    );
  }

  public async start() {
    logger.info('Starting Binance Futures Grid Bot');

    if (this.journal.getSystemState('EMERGENCY_HALTED') === '1') {
      const reason = this.journal.getSystemState('EMERGENCY_REASON') ?? 'UNKNOWN';
      throw new Error(
        `Persistent emergency halt is active (reason=${reason}). Clear it only after investigation.`
      );
    }
    
    // Initial Reconciliation
    const initialReconcileOk = await this.reconciler.reconcile();
    if (!initialReconcileOk || this.reconciler.isHalted) {
      throw new Error('Startup reconciliation failed or halted');
    }

    const shadowCleanStartEnabled =
      this.quantExecutionMode === 'SHADOW' &&
      String(process.env.SHADOW_CLEAN_START ?? '')
        .trim()
        .toLowerCase() === 'yes';

    if (shadowCleanStartEnabled) {
      const cleanup = await sanitizeShadowStartup(
        this.restClient,
        config.SYMBOL,
        true
      );

      logger.warn({
        symbol: config.SYMBOL,
        closedPositionAmount: cleanup.exit?.closedPositionAmount ?? 0,
        canceledAllOrders: cleanup.exit?.canceledAllOrders ?? false
      }, 'SHADOW clean-start completed before symbol risk configuration');
    }

    // Enforce the canonical symbol risk configuration before trading.
    // Any Binance rejection here fails startup closed.
    const startupSymbolConfig = await ensureStartupSymbolRiskConfig(
      this.restClient,
      config.SYMBOL
    );

    logger.info({
      symbol: startupSymbolConfig.symbol,
      marginType: startupSymbolConfig.marginType,
      leverage: startupSymbolConfig.leverage
    }, 'Startup symbol risk configuration verified');
    // Hydrate real exchange position before any strategy cycle. Restarting
    // with an existing futures position while assuming zero exposure is unsafe.
    const startupPosition = await syncStartupRiskState(
      this.restClient,
      this.riskGuard,
      config.SYMBOL
    );

    logger.info({
      symbol: config.SYMBOL,
      positionAmount: startupPosition
    }, 'Startup exchange position synchronized');

    const startupRisk = await this.restClient.getPositionRisk(config.SYMBOL);
    if (Math.abs(startupRisk.positionAmt) >= 1e-12 && startupRisk.entryPrice > 0) {
      this.emergencyRiskEngine.setReferencePrice(startupRisk.entryPrice);
    }

    const startupLiquidationReason =
      this.emergencyRiskEngine.evaluateLiquidationDistance(startupRisk);
    if (startupLiquidationReason) {
      await this.triggerEmergencyStop(startupLiquidationReason, {
        stage: 'startup',
        startupRisk
      });
      return;
    }

    // Warm-start PA from the same configured Binance environment before
    // live scoring begins. This prevents a cold-start NONE/RNG:false state
    // from being compared against a fully warmed historical model.
    await this.warmStartPriceAction();

    // Connect Gateways
    this.marketGateway.connect();
    await this.userGateway.connect();
    this.watchdog.start();

    const pollingIntervals =
      getRuntimePollingIntervals(this.quantExecutionMode);

    logger.info({
      quantExecutionMode: this.quantExecutionMode,
      ...pollingIntervals
    }, 'Runtime polling cadence configured');

    // Prime Open Interest before strategy activity, then keep it fresh.
    await this.refreshOpenInterest();
    this.openInterestInterval = setInterval(
      () => void this.refreshOpenInterest(),
      pollingIntervals.openInterestMs
    );

    // In SHADOW the account is verified flat and execution is disabled, so
    // private-account REST reconciliation/risk polling is deliberately
    // throttled to avoid Binance testnet shared-IP request-limit noise.
    this.reconciliationInterval = setInterval(
      () => void this.runReconciliationCycle(),
      pollingIntervals.reconciliationMs
    );

    await this.refreshPositionRisk();
    this.positionRiskInterval = setInterval(
      () => void this.refreshPositionRisk(),
      pollingIntervals.positionRiskMs
    );

    this.strategyInterval = setInterval(
      () => void this.runStrategyCycle(),
      5000
    ); // Every 5 sec
  }

  private async runReconciliationCycle(): Promise<void> {
    if (this.emergencyExitInProgress) return;

    const ok = await this.reconciler.reconcile();

    if (this.reconciler.isHalted) {
      this.shutdown('Halted by reconciler');
      return;
    }

    await this.recordCriticalOperation(ok, 'reconciliation');
  }

  private async refreshPositionRisk(): Promise<void> {
    if (this.emergencyExitInProgress) return;

    try {
      const snapshot = await this.restClient.getPositionRisk(config.SYMBOL);
      this.riskGuard.syncPosition(snapshot.positionAmt);

      if (
        Math.abs(snapshot.positionAmt) >= 1e-12 &&
        this.emergencyRiskEngine.getReferencePrice() === null &&
        snapshot.entryPrice > 0
      ) {
        this.emergencyRiskEngine.setReferencePrice(snapshot.entryPrice);
      }

      const liquidationReason =
        this.emergencyRiskEngine.evaluateLiquidationDistance(snapshot);

      if (liquidationReason) {
        await this.triggerEmergencyStop(liquidationReason, { snapshot });
        return;
      }

      await this.recordCriticalOperation(true, 'position-risk');
    } catch (err) {
      logger.error({ err }, 'Position risk refresh failed');
      await this.recordCriticalOperation(false, 'position-risk');
    }
  }

  private async recordCriticalOperation(
    success: boolean,
    context: string
  ): Promise<void> {
    if (this.emergencyExitInProgress) return;

    if (success) {
      this.emergencyRiskEngine.recordCriticalSuccess();
      return;
    }

    const reason = this.emergencyRiskEngine.recordCriticalFailure();
    logger.warn({
      context,
      consecutiveCriticalErrors:
        this.emergencyRiskEngine.getConsecutiveCriticalErrors()
    }, 'Critical operation failed');

    if (reason) {
      await this.triggerEmergencyStop(reason, { context });
    }
  }

  private async triggerEmergencyStop(
    reason: EmergencyReason,
    details: Record<string, unknown> = {}
  ): Promise<void> {
    if (this.emergencyExitInProgress) return;
    this.emergencyExitInProgress = true;

    this.journal.setSystemState('EMERGENCY_HALTED', '1');
    this.journal.setSystemState('EMERGENCY_REASON', reason);
    this.journal.setSystemState('EMERGENCY_AT', String(Date.now()));

    if (this.strategyInterval) clearInterval(this.strategyInterval);
    if (this.reconciliationInterval) clearInterval(this.reconciliationInterval);
    if (this.openInterestInterval) clearInterval(this.openInterestInterval);
    if (this.positionRiskInterval) clearInterval(this.positionRiskInterval);

    logger.fatal({ reason, ...details }, 'EMERGENCY KILL SWITCH TRIGGERED');

    try {
      const result = await executeEmergencyExit(
        this.restClient,
        config.SYMBOL
      );
      logger.fatal({ reason, result }, 'Emergency exit completed and verified flat');
    } catch (err) {
      logger.fatal({ reason, err }, 'Emergency exit failed or could not be fully verified');
    } finally {
      this.shutdown(`Emergency kill switch: ${reason}`);
    }
  }

  private async refreshOpenInterest(): Promise<void> {
    try {
      const snapshot =
        await this.restClient.getOpenInterest(config.SYMBOL);

      const previousOpenInterest =
        this.openInterestTracker.getPreviousOpenInterest();
      const previousSnapshotTime =
        this.openInterestTracker.getLastSnapshotTime();

      this.currentOiDelta =
        this.openInterestTracker.update(snapshot.openInterest, snapshot.time);

      const acceptedFreshSnapshot =
        this.openInterestTracker.getLastSnapshotTime() !== previousSnapshotTime;

      if (!acceptedFreshSnapshot) {
        return;
      }

      if (previousOpenInterest === null) {
        logger.info({
          symbol: config.SYMBOL,
          openInterest: snapshot.openInterest,
          exchangeTime: snapshot.time
        }, 'Live open interest initialized');
      } else {
        logger.debug({
          symbol: config.SYMBOL,
          openInterest: snapshot.openInterest,
          oiDelta: this.currentOiDelta,
          exchangeTime: snapshot.time
        }, 'Live open interest updated');
      }
    } catch (err) {
      this.currentOiDelta = 'UNAVAILABLE_DUE_TO_DATA';
      logger.warn({ err }, 'Open interest unavailable; continuing without OI signal');
    }
  }

  private async runStrategyCycle() {
    if (this.reconciler.isHalted || this.emergencyExitInProgress) return;

    const currentPrice = this.marketGateway.getCurrentPrice();
    if (currentPrice === 0) return; // Wait for market data

    const currentPosition = this.riskGuard.getCurrentPosition();
    const openIntents = this.journal.getOpenIntents();
    const realQuantScore = this.getRealQuantScore();

    if (Math.abs(currentPosition) < 1e-12 && openIntents.length === 0) {
      this.emergencyRiskEngine.setReferencePrice(currentPrice);
    }

    const adverseMoveReason =
      this.emergencyRiskEngine.evaluateAdverseMove(
        currentPrice,
        currentPosition
      );

    if (adverseMoveReason) {
      await this.triggerEmergencyStop(adverseMoveReason, {
        currentPrice,
        currentPosition,
        referencePrice: this.emergencyRiskEngine.getReferencePrice()
      });
      return;
    }

    if (this.pendingGridAnchorPrice !== null) {
      if (openIntents.length > 0) {
        logger.info({
          currentPrice,
          pendingAnchorPrice: this.pendingGridAnchorPrice,
          openIntents: openIntents.length
        }, 'Grid recenter waiting for old orders to clear');

        return;
      }

      this.gridAnchorPrice = this.pendingGridAnchorPrice;
      this.pendingGridAnchorPrice = null;
    }

    if (this.gridAnchorPrice === null) {
      this.gridAnchorPrice = currentPrice;
    }

    const priceMove = Math.abs(currentPrice - this.gridAnchorPrice);

    const breakoutActive = Boolean(
      this.activePA?.breakoutUp || this.activePA?.breakoutDown
    );

    if (breakoutActive) {
      for (const open of openIntents) {
        if (
          open.state === LifecycleState.ACKNOWLEDGED ||
          open.state === LifecycleState.PARTIALLY_FILLED
        ) {
          const cancelOk = await this.executionEngine.cancelOrder(open);
          await this.recordCriticalOperation(cancelOk, 'cancel-order');
          if (this.emergencyExitInProgress) return;
        }
      }

      logger.warn({
        currentPrice,
        breakoutUp: this.activePA?.breakoutUp ?? false,
        breakoutDown: this.activePA?.breakoutDown ?? false,
        openIntents: openIntents.length
      }, 'Price-action breakout active; no new grid exposure');

      return;
    }

    if (openIntents.length > 0 && priceMove >= this.gridRecenterThreshold) {
      this.pendingGridAnchorPrice = currentPrice;

      for (const open of openIntents) {
        if (
          open.state === LifecycleState.ACKNOWLEDGED ||
          open.state === LifecycleState.PARTIALLY_FILLED
        ) {
          const cancelOk = await this.executionEngine.cancelOrder(open);
          await this.recordCriticalOperation(cancelOk, 'cancel-order');
          if (this.emergencyExitInProgress) return;
        }
      }

      logger.info({
        currentPrice,
        oldAnchorPrice: this.gridAnchorPrice,
        pendingAnchorPrice: this.pendingGridAnchorPrice,
        priceMove
      }, 'Grid recenter triggered');

      return;
    }

    if (openIntents.length === 0 && priceMove >= this.gridRecenterThreshold) {
      this.gridAnchorPrice = currentPrice;
    }

    if (this.quantExecutionMode === 'SHADOW' && openIntents.length > 0) {
      for (const open of openIntents) {
        if (
          open.state === LifecycleState.ACKNOWLEDGED ||
          open.state === LifecycleState.PARTIALLY_FILLED
        ) {
          const cancelOk = await this.executionEngine.cancelOrder(open);
          await this.recordCriticalOperation(cancelOk, 'shadow-cancel-order');
          if (this.emergencyExitInProgress) return;
        }
      }

      logger.info({
        openIntents: openIntents.length
      }, 'SHADOW mode: canceled resting grid orders and blocked new exposure');
      return;
    }

    // Keep the current grid episode stable.
    // Inventory changes from fills must not re-price every resting order.
    // Recenter logic above remains the only path that replaces an active grid.
    if (openIntents.length > 0) {
      logger.info({
        currentPrice,
        anchorPrice: this.gridAnchorPrice,
        priceMove,
        currentPosition,
        openIntents: openIntents.length,
        quantMode: this.quantExecutionMode,
        realQuantScore
      }, 'Grid episode active; keeping resting orders');

      return;
    }

    const anchorPrice = this.gridAnchorPrice;

    const smokeScore: QuantScore = {
      expectancy: 0.002,
      featureHash: 'testnet-smoke',
      sampleCount: 100,
      hitRate: 0,
      averageWin: 0,
      averageLoss: 0,
      expectedDurationMs: 0,
      mae: 0,
      mfe: 0,
      modelSource: 'NONE'
    };

    const quantDecision = resolveQuantExecution({
      mode: this.quantExecutionMode,
      realQuantScore,
      activePriceAction: this.activePA,
      activeMicrostructure: this.activeMS,
      smokeScore
    });

    if (!quantDecision.canExecute || quantDecision.score === null) {
      logger.info({
        currentPrice,
        anchorPrice,
        currentPosition,
        quantMode: this.quantExecutionMode,
        quantDecision: quantDecision.reason,
        quantModelLoaded: this.quantModelLoaded,
        realQuantScore
      }, 'Quant execution deferred; no new grid exposure');
      return;
    }

    const executionScore = quantDecision.score;
    const executionPA = quantDecision.priceAction;

    const desiredIntents = this.strategyEngine.generateGrid(
      anchorPrice,
      executionPA,
      currentPosition,
      executionScore
    );

    logger.info({
      currentPrice,
      anchorPrice,
      priceMove: Math.abs(currentPrice - anchorPrice),
      currentPosition,
      desiredIntents: desiredIntents.length,
      openIntents: openIntents.length,
      quantMode: this.quantExecutionMode,
      quantDecision: quantDecision.reason,
      quantModelLoaded: this.quantModelLoaded,
      realQuantScore,
      executionScore
    }, 'Strategy cycle');
    // Cancel intents that are no longer in desired grid
    const desiredKeys = new Set(desiredIntents.map(i => `${i.side}-${i.price}`));
    for (const open of openIntents) {
      const key = `${open.side}-${open.price}`;
      if (!desiredKeys.has(key)) {
         // Need to cancel
         // Only cancel if it's already ACKNOWLEDGED or PARTIALLY_FILLED
         if (open.state === LifecycleState.ACKNOWLEDGED || open.state === LifecycleState.PARTIALLY_FILLED) {
           const cancelOk = await this.executionEngine.cancelOrder(open);
          await this.recordCriticalOperation(cancelOk, 'cancel-order');
          if (this.emergencyExitInProgress) return;
         }
      }
    }

    // Place new intents
    const openKeys = new Set(openIntents.map(i => `${i.side}-${i.price}`));
    for (const desired of desiredIntents) {
      const key = `${desired.side}-${desired.price}`;
      if (!openKeys.has(key)) {
         if (this.riskGuard.reserveAndSaveIntent(desired)) {
           logger.info({ desired }, 'Submitting strategy order');
           const submitOk = await this.executionEngine.submitOrder(desired);
           await this.recordCriticalOperation(submitOk, 'submit-order');
           if (this.emergencyExitInProgress) return;
         }
      }
    }
  }

  public shutdown(reason: string) {
    logger.warn({ reason }, 'Shutting down bot');
    if (this.strategyInterval) clearInterval(this.strategyInterval);
    if (this.reconciliationInterval) clearInterval(this.reconciliationInterval);
    if (this.openInterestInterval) clearInterval(this.openInterestInterval);
    if (this.positionRiskInterval) clearInterval(this.positionRiskInterval);
    
    this.watchdog.stop();
    this.marketGateway.disconnect();
    this.userGateway.disconnect();
    
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }
}








