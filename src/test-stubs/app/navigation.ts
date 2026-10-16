// Client-test stand-in for `$app/navigation` (aliased in vite.config.client-test.ts only).
import { page } from './state';

/** Every replaceState call, for assertions. */
export const replaceStateCalls: { url: string; state: App.PageState }[] = [];

/** Every goto call, for assertions. */
export const gotoCalls: { url: string; opts?: { state?: App.PageState } }[] = [];

export async function goto(url: string, opts?: { state?: App.PageState }): Promise<void> {
  gotoCalls.push({ url, opts });
}

export function replaceState(url: string, state: App.PageState): void {
  replaceStateCalls.push({ url, state });
  page.state = state;
}
