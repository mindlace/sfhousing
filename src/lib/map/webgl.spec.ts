import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasWebGL2 } from './webgl';

function stubCanvas(gl: unknown): void {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => gl }) });
}

describe('hasWebGL2', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is false without a DOM', () => {
    expect(hasWebGL2()).toBe(false);
  });

  it('is false when the canvas has no webgl2 context', () => {
    stubCanvas(null);
    expect(hasWebGL2()).toBe(false);
  });

  it('releases the probe context via WEBGL_lose_context', () => {
    const loseContext = vi.fn();
    const getExtension = vi.fn(() => ({ loseContext }));
    stubCanvas({ getExtension });
    expect(hasWebGL2()).toBe(true);
    expect(getExtension).toHaveBeenCalledWith('WEBGL_lose_context');
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it('is still true when WEBGL_lose_context is unavailable', () => {
    stubCanvas({ getExtension: () => null });
    expect(hasWebGL2()).toBe(true);
  });
});
