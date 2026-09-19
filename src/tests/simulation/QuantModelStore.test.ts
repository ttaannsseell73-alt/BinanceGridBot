import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { QuantModelStore } from '../../simulation/QuantModelStore';
import { QuantModelV2 } from '../../strategy/QuantEngine';

const roots: string[] = [];

function makeModel(createdAt: number, forwardReturn: number): QuantModelV2 {
  return {
    version: 2,
    createdAt,
    label: 'MIXED_RETURN_BASIS',
    observations: [{
      exactHash: 'MS:LH|RNG:true|B_UP:false|B_DN:false|S_UP:false|S_DN:false|CVD:pos|IMB:neutral|OI:pos|ABS:false',
      paHash: 'MS:LH',
      forwardReturn,
      holdingTimeMs: 3_600_000,
      returnBasis: 'NET_GRID_EPISODE'
    }]
  };
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-store-'));
  roots.push(root);
  return {
    root,
    runtime: path.join(root, 'data', 'quant.live.json'),
    base: path.join(root, 'artifacts', 'quant.base.json')
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('QuantModelStore', () => {
  it('falls back to the base model when runtime state does not exist', () => {
    const { runtime, base } = setup();
    fs.mkdirSync(path.dirname(base), { recursive: true });
    fs.writeFileSync(base, JSON.stringify(makeModel(1, 0.001)), 'utf8');

    const store = new QuantModelStore(runtime, base);
    const candidates = store.loadCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].source).toBe('BASE');
  });

  it('prefers runtime model over base model', () => {
    const { runtime, base } = setup();
    fs.mkdirSync(path.dirname(base), { recursive: true });
    fs.writeFileSync(base, JSON.stringify(makeModel(1, 0.001)), 'utf8');

    const store = new QuantModelStore(runtime, base);
    store.saveRuntime(makeModel(2, 0.002));

    const candidates = store.loadCandidates();

    expect(candidates[0].source).toBe('RUNTIME');
    expect(candidates[0].model.createdAt).toBe(2);
  });

  it('keeps the previous runtime model as a recovery backup', () => {
    const { runtime, base } = setup();
    const store = new QuantModelStore(runtime, base);

    store.saveRuntime(makeModel(1, 0.001));
    store.saveRuntime(makeModel(2, 0.002));

    fs.writeFileSync(runtime, '{corrupt-json', 'utf8');

    const candidates = store.loadCandidates();

    expect(candidates[0].source).toBe('RUNTIME_BACKUP');
    expect(candidates[0].model.createdAt).toBe(1);
  });

  it('cleans temporary files after a successful save', () => {
    const { runtime, base, root } = setup();
    const store = new QuantModelStore(runtime, base);

    store.saveRuntime(makeModel(1, 0.001));

    const files = fs.readdirSync(path.join(root, 'data'));
    expect(files.some(name => name.endsWith('.tmp'))).toBe(false);
  });
});
