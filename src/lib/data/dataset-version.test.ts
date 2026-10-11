import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATASET_VERSION_RE } from './dataset-version';
import { DATASET_VERSION_RE as reExported } from './manifest';

describe('DATASET_VERSION_RE', () => {
  it('accepts valid versions', () => {
    expect(DATASET_VERSION_RE.test('fixture-0')).toBe(true);
    expect(DATASET_VERSION_RE.test('2026-10-10-3fa9c2d1')).toBe(true);
  });
  it('rejects invalid versions', () => {
    expect(DATASET_VERSION_RE.test('2026-10-10-3FA9C2D1')).toBe(false);
    expect(DATASET_VERSION_RE.test('test-v1')).toBe(false);
  });
  it('manifest re-exports the identical RegExp', () => {
    expect(reExported).toBe(DATASET_VERSION_RE);
  });
  it('dataset-version.ts has no import statements', () => {
    const src = fs.readFileSync(new URL('./dataset-version.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/^import /m);
  });
});
