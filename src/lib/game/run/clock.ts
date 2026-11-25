// The wall clock, the frame loop and the reduced-motion test. Component specs mock this module.

let reduceQuery: MediaQueryList | null | undefined;

export function now(): number {
  return performance.now();
}

export function raf(cb: FrameRequestCallback): number {
  return requestAnimationFrame(cb);
}

export function cancelRaf(h: number): void {
  cancelAnimationFrame(h);
}

/** The live `(prefers-reduced-motion: reduce)` query; false where `matchMedia` is missing. */
export function reducedMotion(): boolean {
  if (reduceQuery === undefined) {
    reduceQuery =
      typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  }
  return reduceQuery?.matches ?? false;
}
