"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderFlowEngine = void 0;
const DEFAULT_CONFIG = {
    windowMs: 15_000,
    minTakerBuyRatioLong: 0.58,
    maxTakerBuyRatioShort: 0.42,
    maxSpreadBps: 4,
};
class OrderFlowEngine {
    config;
    states = new Map();
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    ingestTrade(tick) {
        const state = this.states.get(tick.symbol) ?? { ticks: [] };
        state.ticks.push(tick);
        const cutoff = tick.timestamp - this.config.windowMs;
        while (state.ticks.length && state.ticks[0].timestamp < cutoff)
            state.ticks.shift();
        this.states.set(tick.symbol, state);
    }
    ingestBook(book) {
        const state = this.states.get(book.symbol) ?? { ticks: [] };
        state.book = book;
        this.states.set(book.symbol, state);
    }
    setOiDelta(symbol, oiDeltaPct) {
        const state = this.states.get(symbol) ?? { ticks: [] };
        state.oiDeltaPct = oiDeltaPct;
        this.states.set(symbol, state);
    }
    snapshot(symbol, now) {
        const state = this.states.get(symbol);
        if (!state?.book || state.ticks.length < 3)
            return null;
        const cutoff = now - this.config.windowMs;
        const ticks = state.ticks.filter(t => t.timestamp >= cutoff && t.timestamp <= now);
        if (ticks.length < 3)
            return null;
        let buy = 0;
        let sell = 0;
        for (const t of ticks) {
            const q = t.price * t.quantity;
            if (t.isBuyerMaker)
                sell += q;
            else
                buy += q;
        }
        const total = buy + sell;
        const takerBuyRatio = total > 0 ? buy / total : 0.5;
        const cvdQuote = buy - sell;
        const mid = (state.book.bid + state.book.ask) / 2;
        const spreadBps = mid > 0 ? ((state.book.ask - state.book.bid) / mid) * 10_000 : Infinity;
        const spreadOk = Number.isFinite(spreadBps) && spreadBps <= this.config.maxSpreadBps;
        return {
            symbol,
            timestamp: now,
            takerBuyRatio,
            cvdQuote,
            spreadBps,
            oiDeltaPct: state.oiDeltaPct,
            validForLong: spreadOk && takerBuyRatio >= this.config.minTakerBuyRatioLong && cvdQuote > 0,
            validForShort: spreadOk && takerBuyRatio <= this.config.maxTakerBuyRatioShort && cvdQuote < 0,
        };
    }
}
exports.OrderFlowEngine = OrderFlowEngine;
