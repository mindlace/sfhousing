// Thin shell: all behaviour lives in createSimHost / createScenarioHost (tested in Node) and the
// router that puts them behind this one Worker.
import { createSimHost } from './host';
import { createWorkerRouter } from './router';
import { createScenarioHost } from './scenario/scenario-host';
import type { SimResponse } from './protocol';
import type { ScenarioResponse, WorkerRequest } from './scenario/types';

interface Scope {
  postMessage(msg: SimResponse | ScenarioResponse, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
}
const scope = self as unknown as Scope;
// Conductor ruling: production keeps 1/4/16 s; only the e2e build shortens it.
const retryDelaysMs = import.meta.env.VITE_E2E === '1' ? [50, 100, 200] : undefined;

const router = createWorkerRouter({
  editor: createSimHost({
    fetch: (url) => fetch(url),
    post: (msg, transfer) => scope.postMessage(msg, transfer),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    retryDelaysMs
  }),
  createScenario: () =>
    createScenarioHost({
      fetch: (url) => fetch(url),
      fetchBytes: (url) => fetch(url),
      post: (msg, transfer) => scope.postMessage(msg, transfer),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      now: () => performance.now(),
      retryDelaysMs
    }),
  post: (msg) => scope.postMessage(msg, [])
});
scope.onmessage = (e) => router.handle(e.data);
