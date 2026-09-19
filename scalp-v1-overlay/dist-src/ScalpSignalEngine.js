"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScalpSignalEngine = void 0;
const DEFAULT_CONFIG = { maxRadarAgeMs: 60_000 };
class ScalpSignalEngine {
    config;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    evaluate(now, radar, breakout, flow) {
        const symbol = radar?.symbol ?? breakout?.symbol ?? flow?.symbol ?? 'UNKNOWN';
        const reasons = [];
        if (!radar)
            reasons.push('RADAR_MISSING');
        else if (now - radar.timestamp > this.config.maxRadarAgeMs)
            reasons.push('RADAR_STALE');
        if (!breakout?.valid)
            reasons.push('BREAKOUT_NOT_CONFIRMED');
        if (!flow)
            reasons.push('ORDER_FLOW_MISSING');
        if (radar && breakout && radar.direction !== breakout.direction)
            reasons.push('DIRECTION_MISMATCH_RADAR_BREAKOUT');
        const direction = radar?.direction;
        if (direction === 'LONG' && flow && !flow.validForLong)
            reasons.push('ORDER_FLOW_NOT_LONG');
        if (direction === 'SHORT' && flow && !flow.validForShort)
            reasons.push('ORDER_FLOW_NOT_SHORT');
        if (reasons.length) {
            return { symbol, timestamp: now, action: 'PASS', confidence: 0, radar: radar ?? undefined, breakout: breakout ?? undefined, flow: flow ?? undefined, reasons };
        }
        const directionalFlow = direction === 'LONG' ? flow.takerBuyRatio : 1 - flow.takerBuyRatio;
        const confidence = Math.round(Math.min(100, radar.heatScore * 0.45 +
            Math.min(100, breakout.trendR2 * 100) * 0.25 +
            Math.min(100, directionalFlow * 100) * 0.20 +
            Math.min(100, breakout.volumeRatio * 50) * 0.10));
        return {
            symbol,
            timestamp: now,
            action: direction,
            confidence,
            radar: radar,
            breakout: breakout,
            flow: flow,
            reasons: ['RADAR_OK', 'BREAKOUT_OK', 'ORDER_FLOW_OK'],
        };
    }
}
exports.ScalpSignalEngine = ScalpSignalEngine;
