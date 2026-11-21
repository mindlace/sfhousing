import { vi } from 'vitest';

type Kind = 'coarse' | 'fine';

/**
 * A pointer stub for `window.matchMedia`, set before render: `primary` is what `(pointer: ...)`
 * reports, `any` the kinds `(any-pointer: ...)` does. Every other query is the browser's own (the
 * dock reads `(min-width: 768px)`). `set` changes the primary pointer and `setAny` the kinds, each
 * firing `change` on every pointer query, as a docked keyboard or an added touch screen would.
 * Without `any` the device has one pointer, so `(any-pointer: ...)` follows the primary.
 * Undo with `vi.unstubAllGlobals()` in `afterEach`.
 */
export function stubPointer(
  primary: Kind,
  any?: Kind[]
): { set(p: Kind): void; setAny(a: Kind[]): void } {
  const real = window.matchMedia.bind(window);
  let now = primary;
  // Without `any`, the device has the one pointer: the kinds follow the primary.
  let kinds = any;
  const listeners = new Set<(e: Event) => void>();
  vi.stubGlobal('matchMedia', (q: string) => {
    const k = q.replace(/\s/g, '');
    if (!/^\((any-)?pointer:/.test(k)) return real(q);
    return {
      get matches() {
        return k === `(pointer:${now})` || (kinds ?? [now]).some((a) => k === `(any-pointer:${a})`);
      },
      media: q,
      addEventListener(_type: string, fn: (e: Event) => void) {
        listeners.add(fn);
      },
      removeEventListener(_type: string, fn: (e: Event) => void) {
        listeners.delete(fn);
      }
    } as unknown as MediaQueryList;
  });
  const fire = () => {
    for (const fn of [...listeners]) fn(new Event('change'));
  };
  return {
    set(p) {
      now = p;
      fire();
    },
    setAny(a) {
      kinds = a;
      fire();
    }
  };
}

/** A touch laptop: the trackpad is the primary pointer, the touch screen another. */
export const stubTouchLaptop = () => stubPointer('fine', ['fine', 'coarse']);
