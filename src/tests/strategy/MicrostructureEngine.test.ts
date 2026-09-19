import { describe, it, expect } from 'vitest';
import { MicrostructureEngine } from '../../strategy/MicrostructureEngine';
import { Tick } from '../../models/strategy';

describe('MicrostructureEngine', () => {
  it('should calculate CVD and taker imbalance correctly', () => {
    const engine = new MicrostructureEngine(60000);
    
    // Taker sell (maker is buyer) -> quantity 10
    const t1: Tick = { timestamp: 1000, price: 100, quantity: 10, isBuyerMaker: true };
    let f = engine.processTick(t1, 0);
    expect(f.cvd).toBe(-10);
    expect(f.takerImbalance).toBe(0); // 0 buy / 10 sell

    // Taker buy (maker is seller) -> quantity 30
    const t2: Tick = { timestamp: 2000, price: 101, quantity: 30, isBuyerMaker: false };
    f = engine.processTick(t2, 5);
    expect(f.cvd).toBe(20); // -10 + 30
    expect(f.takerImbalance).toBe(3); // 30 buy / 10 sell
    expect(f.oiDelta).toBe(5);
  });

  it('should detect absorption', () => {
    const engine = new MicrostructureEngine(60000);
    
    // Create lots of volume at the same price level
    let f;
    for (let i = 0; i < 50; i++) {
      f = engine.processTick({
        timestamp: 1000 + i * 10,
        price: 100 + (i % 2 === 0 ? 0.01 : -0.01), // very tight price range
        quantity: 100,
        isBuyerMaker: i % 2 === 0
      }, 0);
    }

    // Absorption should be true because volume is 5000 and price difference is tiny
    expect(f?.absorption).toBe(true);
  });

  it('should prune old ticks outside window for rolling metrics', () => {
    const engine = new MicrostructureEngine(1000); // 1 sec window
    
    // Taker sell
    engine.processTick({ timestamp: 1000, price: 100, quantity: 50, isBuyerMaker: true }, 0);
    
    // Wait > 1 sec, Taker buy
    const f = engine.processTick({ timestamp: 2500, price: 101, quantity: 10, isBuyerMaker: false }, 0);
    
    // CVD is persistent across time, so it should be -50 + 10 = -40
    expect(f.cvd).toBe(-40);
    
    // Taker Imbalance should ONLY be from the window (which only has the 10 buy now)
    // 10 buy / 0 sell -> 100 (our cap)
    expect(f.takerImbalance).toBe(100);
  });
});
