import { describe, it, expect } from 'vitest';
import { MetricsEngine, TradeResult } from '../../simulation/MetricsEngine';

describe('MetricsEngine', () => {
  it('should calculate metrics correctly', () => {
    const engine = new MetricsEngine();
    
    const trades: TradeResult[] = [
      { clientOrderId: '1', side: 'BUY', entryPrice: 100, exitPrice: 100, quantity: 1, pnl: 10, fees: 1, slippage: 1, netPnl: 8, entryTime: 1000, exitTime: 2000, regime: 'TREND_UP', featuresHash: 'HH' },
      { clientOrderId: '2', side: 'SELL', entryPrice: 100, exitPrice: 100, quantity: 1, pnl: -5, fees: 1, slippage: 1, netPnl: -7, entryTime: 2000, exitTime: 3000, regime: 'TREND_UP', featuresHash: 'HH' },
      { clientOrderId: '3', side: 'BUY', entryPrice: 100, exitPrice: 100, quantity: 1, pnl: 20, fees: 1, slippage: 1, netPnl: 18, entryTime: 3000, exitTime: 5000, regime: 'RANGE', featuresHash: 'NONE' },
    ];

    const report = engine.calculateReport(trades, 10000);
    
    expect(report.grossPnl).toBe(25);
    expect(report.netPnl).toBe(19);
    expect(report.totalFees).toBe(3);
    expect(report.totalSlippage).toBe(3);
    expect(report.tradeCount).toBe(3);
    expect(report.gridCycleCount).toBe(1);
    expect(report.hitRate).toBe(2/3);
    expect(report.profitFactor).toBe(26 / 7); // grossProfit = 26, grossLoss = 7
    expect(report.averageWin).toBe(13); // 26 / 2
    expect(report.averageLoss).toBe(7); // 7 / 1
    
    // Regimes
    expect(report.regimePerformance['TREND_UP'].netPnl).toBe(1);
    expect(report.regimePerformance['TREND_UP'].tradeCount).toBe(2);
    expect(report.regimePerformance['RANGE'].netPnl).toBe(18);
  });
});
