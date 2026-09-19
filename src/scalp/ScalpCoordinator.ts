import { EventEmitter } from 'events';
import { FuturesRadarEngine } from './FuturesRadarEngine';
import { OrderFlowEngine } from './OrderFlowEngine';
import { ScalpSignalEngine } from './ScalpSignalEngine';
import { TrendBreakEngine } from './TrendBreakEngine';
import { BookSnapshot, Candle, RadarCandidate, ScalpDecision, TradeTick } from './types';

/**
 * Pure decision coordinator. It never submits an order itself.
 * Existing RiskGuard/ExecutionEngine should consume the emitted `decision` event.
 */
export class ScalpCoordinator extends EventEmitter {
  public readonly radar: FuturesRadarEngine;
  public readonly trend: TrendBreakEngine;
  public readonly flow: OrderFlowEngine;
  public readonly signals: ScalpSignalEngine;
  private readonly activeRadar = new Map<string, RadarCandidate>();

  constructor() {
    super();
    this.radar = new FuturesRadarEngine();
    this.trend = new TrendBreakEngine();
    this.flow = new OrderFlowEngine();
    this.signals = new ScalpSignalEngine();
  }

  public onAggTrade(tick: TradeTick): void {
    this.radar.ingest(tick);
    this.flow.ingestTrade(tick);
  }

  public onBookTicker(book: BookSnapshot): void {
    this.flow.ingestBook(book);
  }

  public onCandle(candle: Candle): void {
    this.trend.ingest(candle);
    if (candle.interval === '1m' && candle.isClosed) this.evaluateSymbol(candle.symbol, candle.timestamp);
  }

  public updateOiDelta(symbol: string, oiDeltaPct: number): void {
    this.flow.setOiDelta(symbol, oiDeltaPct);
  }

  public scanRadar(now: number): RadarCandidate[] {
    const candidates = this.radar.scan(now);
    for (const c of candidates) this.activeRadar.set(c.symbol, c);
    if (candidates.length) this.emit('radar', candidates);
    return candidates;
  }

  public evaluateSymbol(symbol: string, now: number): ScalpDecision {
    const radar = this.activeRadar.get(symbol) ?? null;
    const breakout = radar ? this.trend.detectBreakout(symbol, radar.direction) : null;
    const flow = this.flow.snapshot(symbol, now);
    const decision = this.signals.evaluate(now, radar, breakout, flow);
    this.emit('decision', decision);
    return decision;
  }
}
