"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FastExitEngine = void 0;
const DEFAULT_CONFIG = {
    tp1R: 1.0,
    tp2R: 1.8,
    tp1Fraction: 0.50,
    breakevenBufferBps: 10,
    timeStopMs: 180_000,
};
class FastExitEngine {
    config;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    createPlan(side, entryPrice, hardStop) {
        if (entryPrice <= 0 || hardStop <= 0 || entryPrice === hardStop)
            throw new Error('Invalid entry/stop');
        if (side === 'LONG' && hardStop >= entryPrice)
            throw new Error('LONG stop must be below entry');
        if (side === 'SHORT' && hardStop <= entryPrice)
            throw new Error('SHORT stop must be above entry');
        const r = Math.abs(entryPrice - hardStop);
        const sign = side === 'LONG' ? 1 : -1;
        const buffer = entryPrice * this.config.breakevenBufferBps / 10_000;
        return {
            side,
            entryPrice,
            hardStop,
            tp1Price: entryPrice + sign * this.config.tp1R * r,
            tp1Fraction: this.config.tp1Fraction,
            tp2Price: entryPrice + sign * this.config.tp2R * r,
            tp2Fraction: 1 - this.config.tp1Fraction,
            moveStopAfterTp1To: entryPrice + sign * buffer,
            timeStopMs: this.config.timeStopMs,
            reduceOnly: true,
        };
    }
}
exports.FastExitEngine = FastExitEngine;
