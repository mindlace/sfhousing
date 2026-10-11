/**
 * Latest-value holder that commits to reactive state at most once per animation frame (spec
 * §4.3: the main thread renders the latest score at most once per frame). `push` may be called
 * any number of times per frame; the last value wins and is never dropped.
 */
export function frameLatest<T>(
  initial: T,
  raf: (cb: FrameRequestCallback) => number = (cb) => requestAnimationFrame(cb),
  caf: (h: number) => void = (h) => cancelAnimationFrame(h)
): { readonly current: T; push(v: T): void; dispose(): void } {
  let current = $state.raw(initial);
  let pending: { v: T } | null = null;
  let handle = 0;
  return {
    get current() {
      return current;
    },
    push(v) {
      pending = { v };
      if (handle) return;
      handle = raf(() => {
        handle = 0;
        if (pending) {
          current = pending.v;
          pending = null;
        }
      });
    },
    dispose() {
      if (handle) caf(handle);
      handle = 0;
      pending = null;
    }
  };
}
