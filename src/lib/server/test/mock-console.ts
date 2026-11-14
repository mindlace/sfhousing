import { vi, type MockInstance } from 'vitest';

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';

/**
 * Spy on and SILENCE the given console methods (default: log, warn, error). The
 * standard way to suppress EXPECTED console noise so it doesn't trip signoff's
 * stderr policer, while still allowing assertions on the returned spies:
 *
 *   const { error } = mockConsole('error');
 *   ...
 *   expect(error).toHaveBeenCalled();
 *
 * or purely to silence:  beforeEach(() => mockConsole('warn'));
 *
 * Restore via the test's `vi.restoreAllMocks()` (or vitest's auto-restore).
 * No dependencies beyond `vitest`, so it's importable from client and server
 * specs alike.
 */
export function mockConsole<M extends ConsoleMethod = 'log' | 'warn' | 'error'>(
  ...methods: M[]
): Record<M, MockInstance> {
  const keys = (methods.length ? methods : ['log', 'warn', 'error']) as M[];
  const spies = {} as Record<M, MockInstance>;
  // `as never`: at the generic `M`, `mockImplementation`'s parameter is the union
  // of every console method's signature, which a bare `() => void` can't satisfy.
  for (const k of keys) spies[k] = vi.spyOn(console, k).mockImplementation((() => {}) as never);
  return spies;
}
