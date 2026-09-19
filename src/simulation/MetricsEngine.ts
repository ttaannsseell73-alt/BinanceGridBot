import { OrderIntent } from '../models/types';
import { QuantScore } from '../models/strategy';

export interface TradeResult {
  clientOrderId: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  fees: number;
  slippage: number;
  netPnl: number;
  entryTime: number;
  exitTime: number;
  regime: string;
  featuresHash: string;
}

export interface SimulationReport {
  grossPnl: number;
  netPnl: number;
  totalFees: number;
  totalSlippage: number;
  tradeCount: number;
  gridCycleCount: number;
  gridCampaignCount: number;
  averageFillsPerCampaign: number;
  averageCampaignDuration: number;
  capitalUtilization: number;
  inventoryExcursion: number;
  maxAdverseInventory: number;
  feesToGrossEdgeRatio: number;
  hitRate: number;
  expectancy: number;
  profitFactor: number;
  averageWin: number;
  averageLoss: number;
  mae: number;
  mfe: number;
  maxDrawdown: number;
  exposureTimeMs: number;
  averageHoldingTimeMs: number;
  riskAdjustedReturn: number;
  regimePerformance: Record<string, { netPnl: number; tradeCount: number; hitRate: number }>;
  featurePerformance: Record<string, { netPnl: number; tradeCount: number; hitRate: number }>;
}

export class MetricsEngine {
  public calculateReport(trades: TradeResult[], initialCapital: number): SimulationReport {
    let grossPnl = 0;
    let netPnl = 0;
    let totalFees = 0;
    let totalSlippage = 0;
    
    let winningTrades = 0;
    let losingTrades = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let totalHoldingTime = 0;
    
    let peakCapital = initialCapital;
    let maxDrawdown = 0;
    let currentCapital = initialCapital;
    
    let currentInventory = 0;
    let maxAdverseInventory = 0;
    let totalInventoryExcursion = 0;

    const regimePerf: Record<string, { netPnl: number; tradeCount: number; hits: number }> = {};
    const featurePerf: Record<string, { netPnl: number; tradeCount: number; hits: number }> = {};

    // Group by campaigns assuming each block of trades within a short time or sequentially forms campaigns
    // Simplified: campaign is bounded by inventory returning to 0.
    let activeCampaign = false;
    let gridCampaignCount = 0;
    let campaignStartTime = 0;
    let totalCampaignDuration = 0;
    let campaignFills = 0;
    let totalCampaignFills = 0;

    for (const t of trades) {
      grossPnl += t.pnl;
      netPnl += t.netPnl;
      totalFees += t.fees;
      totalSlippage += t.slippage;

      if (t.netPnl > 0) {
        winningTrades++;
        grossProfit += t.netPnl;
      } else if (t.netPnl < 0) {
        losingTrades++;
        grossLoss += Math.abs(t.netPnl);
      } // Break even is neither win nor loss

      totalHoldingTime += (t.exitTime - t.entryTime);

      currentCapital += t.netPnl;
      if (currentCapital > peakCapital) {
        peakCapital = currentCapital;
      }
      const drawdown = (peakCapital - currentCapital) / peakCapital;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }

      // Inventory Tracking
      if (t.side === 'BUY') {
        currentInventory += t.quantity;
      } else {
        currentInventory -= t.quantity;
      }
      
      const absInv = Math.abs(currentInventory);
      if (absInv > maxAdverseInventory) {
         maxAdverseInventory = absInv;
      }
      totalInventoryExcursion += absInv;

      // Campaign Tracking
      if (!activeCampaign && absInv > 0) {
         activeCampaign = true;
         gridCampaignCount++;
         campaignStartTime = t.exitTime;
      }
      if (activeCampaign) {
         campaignFills++;
         if (absInv < 0.0001) { // back to 0
             activeCampaign = false;
             totalCampaignDuration += (t.exitTime - campaignStartTime);
             totalCampaignFills += campaignFills;
             campaignFills = 0;
         }
      }

      // Regime tracking
      if (!regimePerf[t.regime]) {
        regimePerf[t.regime] = { netPnl: 0, tradeCount: 0, hits: 0 };
      }
      regimePerf[t.regime].netPnl += t.netPnl;
      regimePerf[t.regime].tradeCount++;
      if (t.netPnl > 0) regimePerf[t.regime].hits++;

      // Feature tracking
      if (!featurePerf[t.featuresHash]) {
        featurePerf[t.featuresHash] = { netPnl: 0, tradeCount: 0, hits: 0 };
      }
      featurePerf[t.featuresHash].netPnl += t.netPnl;
      featurePerf[t.featuresHash].tradeCount++;
      if (t.netPnl > 0) featurePerf[t.featuresHash].hits++;
    }
    
    // Close pending campaign if any
    if (activeCampaign) {
        totalCampaignFills += campaignFills;
        totalCampaignDuration += (trades[trades.length - 1].exitTime - campaignStartTime);
    }

    const tradeCount = trades.length;
    const hitRate = tradeCount > 0 ? winningTrades / tradeCount : 0;
    const averageWin = winningTrades > 0 ? grossProfit / winningTrades : 0;
    const averageLoss = losingTrades > 0 ? grossLoss / losingTrades : 0;
    const expectancy = (hitRate * averageWin) - ((1 - hitRate) * averageLoss);
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
    const averageHoldingTimeMs = tradeCount > 0 ? totalHoldingTime / tradeCount : 0;
    const riskAdjustedReturn = maxDrawdown > 0 ? netPnl / (initialCapital * maxDrawdown) : netPnl;

    const finalRegimePerf: Record<string, { netPnl: number; tradeCount: number; hitRate: number }> = {};
    for (const [k, v] of Object.entries(regimePerf)) {
      finalRegimePerf[k] = { netPnl: v.netPnl, tradeCount: v.tradeCount, hitRate: v.hits / v.tradeCount };
    }

    const finalFeaturePerf: Record<string, { netPnl: number; tradeCount: number; hitRate: number }> = {};
    for (const [k, v] of Object.entries(featurePerf)) {
      finalFeaturePerf[k] = { netPnl: v.netPnl, tradeCount: v.tradeCount, hitRate: v.hits / v.tradeCount };
    }

    const gridCycleCount = Math.floor(tradeCount / 2);
    const averageFillsPerCampaign = gridCampaignCount > 0 ? totalCampaignFills / gridCampaignCount : 0;
    const averageCampaignDuration = gridCampaignCount > 0 ? totalCampaignDuration / gridCampaignCount : 0;
    const capitalUtilization = maxAdverseInventory > 0 ? (maxAdverseInventory * (trades[0]?.entryPrice || 0)) / initialCapital : 0;
    const feesToGrossEdgeRatio = grossPnl > 0 ? totalFees / grossPnl : 0;
    const inventoryExcursion = tradeCount > 0 ? totalInventoryExcursion / tradeCount : 0;

    return {
      grossPnl,
      netPnl,
      totalFees,
      totalSlippage,
      tradeCount,
      gridCycleCount,
      gridCampaignCount,
      averageFillsPerCampaign,
      averageCampaignDuration,
      capitalUtilization,
      inventoryExcursion,
      maxAdverseInventory,
      feesToGrossEdgeRatio,
      hitRate,
      expectancy,
      profitFactor,
      averageWin,
      averageLoss,
      mae: 0,
      mfe: 0,
      maxDrawdown,
      exposureTimeMs: totalHoldingTime,
      averageHoldingTimeMs,
      riskAdjustedReturn,
      regimePerformance: finalRegimePerf,
      featurePerformance: finalFeaturePerf
    };
  }
}
