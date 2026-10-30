// The worker router (spec §4.1): the scenario host beside the unchanged editor host, behind the
// same Worker. Worker-bundle module: DOM-free and $app-free.
import type { SimRequest } from './protocol';
import type { ScenarioRequest, WorkerRequest } from './scenario/types';

export interface RouterDeps {
  editor: { handle(r: SimRequest): void; dispose(): void };
  /**
   * Called at most once: on the first `initScenario`, or a `reroll` or `setLevers` that arrives
   * before one.
   */
  createScenario: () => { handle(r: ScenarioRequest): void; dispose(): void };
}

export function createWorkerRouter(deps: RouterDeps): { handle(req: WorkerRequest): void } {
  type ScenarioHandle = ReturnType<RouterDeps['createScenario']>;
  let scenario: ScenarioHandle | null = null;
  // Which host received the latest `init` / `initScenario`; the editor before either.
  let mode: 'editor' | 'scenario' = 'editor';

  const scenarioHost = (): ScenarioHandle => (scenario ??= deps.createScenario());

  return {
    handle(req) {
      switch (req.type) {
        case 'init':
          mode = 'editor';
          scenario?.dispose();
          deps.editor.handle(req);
          return;
        case 'load':
        case 'preview':
        case 'cancelPreview':
        case 'commit':
        case 'undo':
          deps.editor.handle(req);
          return;
        case 'initScenario':
          mode = 'scenario';
          deps.editor.dispose();
          scenarioHost().handle(req);
          return;
        case 'reroll':
        case 'setLevers':
          // With no scenario host yet, a lazily created one answers `bad-request`.
          scenarioHost().handle(req);
          return;
        case 'prefetch':
        case 'retryChunks':
          if (mode === 'scenario') scenarioHost().handle(req);
          else deps.editor.handle(req);
          return;
        case 'parcelSummary':
          // `req` may be the editor's shape (no `day`); a scenario client always sends the full one.
          if (mode === 'scenario') scenarioHost().handle(req as ScenarioRequest);
          // The editor's request shape has no `day` or `projectId`.
          else
            deps.editor.handle({ type: 'parcelSummary', reqId: req.reqId, parcelId: req.parcelId });
          return;
        default: {
          const unreachable: never = req;
          void unreachable;
        }
      }
    }
  };
}
