const assert = require('node:assert/strict');
const { FuturesRadarEngine } = require('../dist-src/FuturesRadarEngine');
const { OrderFlowEngine } = require('../dist-src/OrderFlowEngine');
const { ScalpSignalEngine } = require('../dist-src/ScalpSignalEngine');
const { ScalpRiskPolicy } = require('../dist-src/ScalpRiskPolicy');
const { FastExitEngine } = require('../dist-src/FastExitEngine');

const radar = new FuturesRadarEngine({ minQuoteVolumeUsd: 1000, minAbsPriceImpulsePct: 0.1, minVolumeImpulse: 1.2, minTradeRateImpulse: 1.2 });
const symbol = 'TESTUSDT'; const start = 1000000;
for (let i = 0; i < 45; i++) radar.ingest({ symbol, timestamp:start+i*6000, price:100, quantity:1, isBuyerMaker:i%2===0 });
const hotStart=start+270000;
for (let i = 0; i < 30; i++) radar.ingest({ symbol, timestamp:hotStart+i*1000, price:100+i*0.03, quantity:10, isBuyerMaker:i%5===0 });
const candidates=radar.scan(hotStart+29000);
assert.equal(candidates.length,1); assert.equal(candidates[0].direction,'LONG'); assert.ok(candidates[0].heatScore>=70);

const flow=new OrderFlowEngine(); const now=2000000;
flow.ingestBook({symbol:'X',timestamp:now,bid:100,ask:100.01});
for(let i=0;i<10;i++) flow.ingestTrade({symbol:'X',timestamp:now-9000+i*1000,price:100,quantity:2,isBuyerMaker:i<2});
const f=flow.snapshot('X',now); assert.equal(f.validForLong,true);
const signal=new ScalpSignalEngine().evaluate(now,{symbol:'X',direction:'LONG',timestamp:now,heatScore:90,priceImpulsePct:0.5,quoteVolume:50000,tradeRatePerSec:5,volumeImpulse:3,tradeRateImpulse:3,takerBuyRatio:0.8},{symbol:'X',direction:'LONG',timestamp:now,breakoutPrice:101,projectedLinePrice:100.5,distanceBps:49,volumeRatio:2,trendR2:0.9,valid:true},f);
assert.equal(signal.action,'LONG');

const risk=new ScalpRiskPolicy();
const sized=risk.size({entryPrice:100,stopPrice:99.6,currentOpenRiskUsd:0,realizedPnlTodayUsd:0,leverage:3});
assert.equal(sized.allowed,true); assert.ok(Math.abs(sized.riskUsd-5)<1e-9); assert.ok(Math.abs(sized.marginUsd-416.6666666667)<0.001);
const plan=new FastExitEngine().createPlan('LONG',100,99.6);
assert.ok(Math.abs(plan.tp1Price-100.4)<1e-9); assert.ok(Math.abs(plan.tp2Price-100.72)<1e-9); assert.equal(plan.reduceOnly,true);
console.log('SCALP_V1_TESTS_PASS');
