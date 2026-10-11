// Thin shell: all behaviour lives in createSimHost (tested in Node).
import { createSimHost } from './host';
import type { SimRequest, SimResponse } from './protocol';

interface Scope {
  postMessage(msg: SimResponse, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<SimRequest>) => void) | null;
}
const scope = self as unknown as Scope;
const host = createSimHost({
  fetch: (url) => fetch(url),
  post: (msg, transfer) => scope.postMessage(msg, transfer),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  // Conductor ruling: production keeps 1/4/16 s; only the e2e build shortens it.
  retryDelaysMs: import.meta.env.VITE_E2E === '1' ? [50, 100, 200] : undefined
});
scope.onmessage = (e) => host.handle(e.data);
