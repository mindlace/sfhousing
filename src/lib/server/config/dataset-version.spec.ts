import { describe, expect, it } from 'vitest';
import { requireDatasetVersion } from './dataset-version';

function failure(value: string | undefined): { status: number; message: string } {
  try {
    requireDatasetVersion(value);
  } catch (e) {
    const err = e as { status: number; body: { message: string } };
    return { status: err.status, message: err.body.message };
  }
  throw new Error('expected requireDatasetVersion to throw');
}

describe('requireDatasetVersion', () => {
  it.each(['2026-10-10-3fa9c2d1', 'fixture-0', 'fixture-12'])('returns %s unchanged', (v) => {
    expect(requireDatasetVersion(v)).toBe(v);
  });

  it('throws 500 naming the variable when missing', () => {
    const f = failure(undefined);
    expect(f.status).toBe(500);
    expect(f.message).toContain('PUBLIC_DATASET_VERSION is not set');
  });

  it('throws 500 on the empty string', () => {
    expect(failure('').status).toBe(500);
  });

  it.each(['test-v1', '2026-10-10-3FA9C2D1'])('throws 500 echoing malformed %s', (v) => {
    const f = failure(v);
    expect(f.status).toBe(500);
    expect(f.message).toContain(`"${v}"`);
    expect(f.message).toContain('PUBLIC_DATASET_VERSION');
  });

  it('truncates absurdly long values', () => {
    const f = failure('x'.repeat(500));
    expect(f.message.length).toBeLessThan(300);
  });
});
