import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import golden from './fixtures/math-golden.json';
import { exp, log } from './math';

const view = new DataView(new ArrayBuffer(8));

function bits(x: number): string {
  view.setFloat64(0, x);
  return (
    view.getUint32(0).toString(16).padStart(8, '0') +
    view.getUint32(4).toString(16).padStart(8, '0')
  );
}

function fromHex(hex: string): number {
  view.setUint32(0, parseInt(hex.slice(0, 8), 16));
  view.setUint32(4, parseInt(hex.slice(8), 16));
  return view.getFloat64(0);
}

function isNanPattern(hex: string): boolean {
  const hi = parseInt(hex.slice(0, 8), 16);
  const mantissa = (hi & 0x000fffff) !== 0 || parseInt(hex.slice(8), 16) !== 0;
  return (hi & 0x7ff00000) === 0x7ff00000 && mantissa;
}

function check(name: string, fn: (x: number) => number, pairs: string[][]) {
  describe(name, () => {
    it('has a populated golden', () => {
      expect(pairs.length).toBeGreaterThanOrEqual(150);
    });

    it('matches the C fdlibm bit pattern for every input', () => {
      for (const [xHex, yHex] of pairs) {
        const y = fn(fromHex(xHex));
        if (isNanPattern(yHex)) {
          expect(Number.isNaN(y), `${name}(${xHex}) should be NaN`).toBe(true);
        } else {
          expect(bits(y), `${name}(${xHex})`).toBe(yHex);
        }
      }
    });
  });
}

describe('math.ts cross-engine golden (server / V8)', () => {
  check('exp', exp, golden.exp);
  check('log', log, golden.log);

  it('does not call Math.exp, Math.log, Math.pow, Math.log1p or Math.expm1', () => {
    const source = readFileSync(new URL('./math.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/Math\.(exp|log|pow|log1p|expm1)\b/);
  });

  it('does not use the ** or **= operator in code (comments ignored)', () => {
    const source = readFileSync(new URL('./math.ts', import.meta.url), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\*\*/);
  });
});
