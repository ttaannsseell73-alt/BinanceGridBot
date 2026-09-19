"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrendBreakEngine = void 0;
const DEFAULT_CONFIG = {
    max5mCandles: 120,
    max1mCandles: 180,
    pivotSpan: 2,
    minPivots: 3,
    minTrendR2: 0.72,
    breakoutBufferBps: 2,
    minVolumeRatio: 1.20,
    volumeLookback: 20,
};
class TrendBreakEngine {
    config;
    candles5m = new Map();
    candles1m = new Map();
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    ingest(candle) {
        if (!candle.isClosed)
            return;
        const target = candle.interval === '5m' ? this.candles5m : this.candles1m;
        const max = candle.interval === '5m' ? this.config.max5mCandles : this.config.max1mCandles;
        const arr = target.get(candle.symbol) ?? [];
        const last = arr[arr.length - 1];
        if (last?.timestamp === candle.timestamp)
            arr[arr.length - 1] = candle;
        else
            arr.push(candle);
        if (arr.length > max)
            arr.splice(0, arr.length - max);
        target.set(candle.symbol, arr);
    }
    detectBreakout(symbol, direction) {
        const five = this.candles5m.get(symbol) ?? [];
        const one = this.candles1m.get(symbol) ?? [];
        if (five.length < 10 || one.length < this.config.volumeLookback + 1)
            return null;
        const line = direction === 'LONG'
            ? this.fitTrendLine(five, 'DESCENDING_RESISTANCE')
            : this.fitTrendLine(five, 'ASCENDING_SUPPORT');
        if (!line || line.r2 < this.config.minTrendR2)
            return null;
        const current = one[one.length - 1];
        const projected = this.project(line, current.timestamp);
        const distanceBps = direction === 'LONG'
            ? ((current.close - projected) / projected) * 10_000
            : ((projected - current.close) / projected) * 10_000;
        const prev = one.slice(Math.max(0, one.length - 1 - this.config.volumeLookback), -1);
        const medianVolume = this.median(prev.map(c => c.volume));
        const volumeRatio = medianVolume > 0 ? current.volume / medianVolume : 0;
        const valid = distanceBps >= this.config.breakoutBufferBps && volumeRatio >= this.config.minVolumeRatio;
        return {
            symbol,
            direction,
            timestamp: current.timestamp,
            breakoutPrice: current.close,
            projectedLinePrice: projected,
            distanceBps,
            volumeRatio,
            trendR2: line.r2,
            valid,
        };
    }
    getTrendLine(symbol, direction) {
        const five = this.candles5m.get(symbol) ?? [];
        return direction === 'LONG'
            ? this.fitTrendLine(five, 'DESCENDING_RESISTANCE')
            : this.fitTrendLine(five, 'ASCENDING_SUPPORT');
    }
    fitTrendLine(candles, kind) {
        const pivots = kind === 'DESCENDING_RESISTANCE'
            ? this.pivotHighs(candles)
            : this.pivotLows(candles);
        if (pivots.length < this.config.minPivots)
            return null;
        const selected = pivots.slice(-Math.max(this.config.minPivots, 5));
        const values = selected.map(p => p.price);
        const descending = values.every((v, i) => i === 0 || v < values[i - 1]);
        const ascending = values.every((v, i) => i === 0 || v > values[i - 1]);
        if (kind === 'DESCENDING_RESISTANCE' && !descending)
            return null;
        if (kind === 'ASCENDING_SUPPORT' && !ascending)
            return null;
        const baseTimestamp = selected[0].timestamp;
        const xs = selected.map(p => p.timestamp - baseTimestamp);
        const ys = selected.map(p => p.price);
        const fit = this.linearRegression(xs, ys);
        if (kind === 'DESCENDING_RESISTANCE' && fit.slope >= 0)
            return null;
        if (kind === 'ASCENDING_SUPPORT' && fit.slope <= 0)
            return null;
        return {
            kind,
            baseTimestamp,
            intercept: fit.intercept,
            slopePerMs: fit.slope,
            r2: fit.r2,
            pivots: selected.length,
        };
    }
    pivotHighs(candles) {
        const out = [];
        const s = this.config.pivotSpan;
        for (let i = s; i < candles.length - s; i++) {
            const v = candles[i].high;
            let ok = true;
            for (let j = i - s; j <= i + s; j++)
                if (j !== i && candles[j].high >= v)
                    ok = false;
            if (ok)
                out.push({ timestamp: candles[i].timestamp, price: v });
        }
        return out;
    }
    pivotLows(candles) {
        const out = [];
        const s = this.config.pivotSpan;
        for (let i = s; i < candles.length - s; i++) {
            const v = candles[i].low;
            let ok = true;
            for (let j = i - s; j <= i + s; j++)
                if (j !== i && candles[j].low <= v)
                    ok = false;
            if (ok)
                out.push({ timestamp: candles[i].timestamp, price: v });
        }
        return out;
    }
    project(line, timestamp) {
        return line.intercept + line.slopePerMs * (timestamp - line.baseTimestamp);
    }
    median(values) {
        if (!values.length)
            return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    linearRegression(xs, ys) {
        const n = xs.length;
        const meanX = xs.reduce((a, b) => a + b, 0) / n;
        const meanY = ys.reduce((a, b) => a + b, 0) / n;
        let num = 0;
        let den = 0;
        for (let i = 0; i < n; i++) {
            num += (xs[i] - meanX) * (ys[i] - meanY);
            den += (xs[i] - meanX) ** 2;
        }
        const slope = den === 0 ? 0 : num / den;
        const intercept = meanY - slope * meanX;
        let ssRes = 0;
        let ssTot = 0;
        for (let i = 0; i < n; i++) {
            const pred = intercept + slope * xs[i];
            ssRes += (ys[i] - pred) ** 2;
            ssTot += (ys[i] - meanY) ** 2;
        }
        const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
        return { slope, intercept, r2 };
    }
}
exports.TrendBreakEngine = TrendBreakEngine;
