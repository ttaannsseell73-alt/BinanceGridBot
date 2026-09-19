"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FuturesRadarEngine = void 0;
const DEFAULT_CONFIG = {
    windowMs: 30_000,
    baselineWindowMs: 300_000,
    minQuoteVolumeUsd: 25_000,
    minAbsPriceImpulsePct: 0.20,
    minVolumeImpulse: 1.8,
    minTradeRateImpulse: 1.8,
    minDirectionalTakerRatio: 0.58,
    minHeatScore: 70,
    maxSymbols: 5,
};
class FuturesRadarEngine {
    config;
    states = new Map();
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    ingest(tick) {
        if (!Number.isFinite(tick.price) || !Number.isFinite(tick.quantity) || tick.price <= 0 || tick.quantity <= 0)
            return;
        const state = this.states.get(tick.symbol) ?? { ticks: [] };
        state.ticks.push(tick);
        const cutoff = tick.timestamp - this.config.baselineWindowMs;
        while (state.ticks.length && state.ticks[0].timestamp < cutoff)
            state.ticks.shift();
        this.states.set(tick.symbol, state);
    }
    scan(now) {
        const candidates = [];
        for (const [symbol, state] of this.states) {
            const c = this.evaluateSymbol(symbol, state.ticks, now);
            if (c)
                candidates.push(c);
        }
        return candidates.sort((a, b) => b.heatScore - a.heatScore).slice(0, this.config.maxSymbols);
    }
    evaluateSymbol(symbol, ticks, now) {
        const recentCut = now - this.config.windowMs;
        const baseCut = now - this.config.baselineWindowMs;
        const recent = ticks.filter(t => t.timestamp >= recentCut && t.timestamp <= now);
        const baseline = ticks.filter(t => t.timestamp >= baseCut && t.timestamp < recentCut);
        if (recent.length < 4 || baseline.length < 8)
            return null;
        const first = recent[0];
        const last = recent[recent.length - 1];
        const priceImpulsePct = ((last.price - first.price) / first.price) * 100;
        const absImpulse = Math.abs(priceImpulsePct);
        const quoteVolume = this.quoteVolume(recent);
        const recentSeconds = Math.max(1, this.config.windowMs / 1000);
        const tradeRatePerSec = recent.length / recentSeconds;
        const baselineMs = Math.max(1, this.config.baselineWindowMs - this.config.windowMs);
        const baselineScale = this.config.windowMs / baselineMs;
        const baselineEquivalentVolume = this.quoteVolume(baseline) * baselineScale;
        const baselineEquivalentTrades = baseline.length * baselineScale;
        const volumeImpulse = baselineEquivalentVolume > 0 ? quoteVolume / baselineEquivalentVolume : 0;
        const tradeRateImpulse = baselineEquivalentTrades > 0 ? recent.length / baselineEquivalentTrades : 0;
        let buyQuote = 0;
        let totalQuote = 0;
        for (const t of recent) {
            const q = t.price * t.quantity;
            totalQuote += q;
            if (!t.isBuyerMaker)
                buyQuote += q;
        }
        const takerBuyRatio = totalQuote > 0 ? buyQuote / totalQuote : 0.5;
        const direction = priceImpulsePct >= 0 ? 'LONG' : 'SHORT';
        const directionalRatio = direction === 'LONG' ? takerBuyRatio : 1 - takerBuyRatio;
        if (quoteVolume < this.config.minQuoteVolumeUsd)
            return null;
        if (absImpulse < this.config.minAbsPriceImpulsePct)
            return null;
        if (volumeImpulse < this.config.minVolumeImpulse)
            return null;
        if (tradeRateImpulse < this.config.minTradeRateImpulse)
            return null;
        if (directionalRatio < this.config.minDirectionalTakerRatio)
            return null;
        const heatScore = Math.round(Math.min(100, this.score(absImpulse, this.config.minAbsPriceImpulsePct, 30) +
            this.score(volumeImpulse, this.config.minVolumeImpulse, 25) +
            this.score(tradeRateImpulse, this.config.minTradeRateImpulse, 25) +
            this.score(directionalRatio, this.config.minDirectionalTakerRatio, 20)));
        if (heatScore < this.config.minHeatScore)
            return null;
        return {
            symbol,
            direction,
            timestamp: now,
            heatScore,
            priceImpulsePct,
            quoteVolume,
            tradeRatePerSec,
            volumeImpulse,
            tradeRateImpulse,
            takerBuyRatio,
        };
    }
    quoteVolume(ticks) {
        return ticks.reduce((sum, t) => sum + t.price * t.quantity, 0);
    }
    score(value, threshold, maxPoints) {
        if (threshold <= 0)
            return maxPoints;
        return Math.min(maxPoints, maxPoints * value / (threshold * 2));
    }
}
exports.FuturesRadarEngine = FuturesRadarEngine;
