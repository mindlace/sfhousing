// The worker router (spec §4.1): the scenario host beside the unchanged editor host and the
// timeline host, behind the same Worker. Worker-bundle module: DOM-free and $app-free.
import type { SimRequest, SimResponse } from './protocol';
import type { ScenarioRequest, ScenarioResponse, WorkerRequest } from './scenario/types';
import type {
  TimelineHostRequest,
  TimelineHostResponse,
  TimelineRequest
} from './timeline-protocol';

type WorkerMode = 'editor' | 'scenario' | 'timeline';

export interface RouterDeps {
  editor: { handle(r: SimRequest): void; dispose(): void };
  /**
   * Called on the first `initScenario` (or a `reroll` or `setLevers` outside timeline mode that
   * arrives before one), and again on the next one after an `init` or `openTimeline` disposed it.
   */
  createScenario: () => { handle(r: ScenarioRequest): void; dispose(): void };
  /**
   * Called on the first `openTimeline` (timeline mode), and again on the next one after an
   * `init` or `initScenario` disposed it.
   */
  createTimeline: () => { handle(r: TimelineHostRequest): void; dispose(): void };
  /**
   * The router's own answers: brush, outline, preview and lid requests outside scenario mode
   * (`no-session`), `bad-request` errors, and the editor's `heightLots` outside editor mode
   * (`result: null`).
   */
  post(msg: ScenarioResponse | SimResponse | TimelineHostResponse): void;
}

export function createWorkerRouter(deps: RouterDeps): {
  handle(req: WorkerRequest | TimelineRequest): void;
} {
  type ScenarioHandle = ReturnType<RouterDeps['createScenario']>;
  type TimelineHandle = ReturnType<RouterDeps['createTimeline']>;
  let timeline: TimelineHandle | null = null;
  let scenario: ScenarioHandle | null = null;
  // Which host received the latest `init` / `initScenario` / `openTimeline`; the editor before any.
  let mode: WorkerMode = 'editor';

  const scenarioHost = (): ScenarioHandle => (scenario ??= deps.createScenario());
  const timelineHost = (): TimelineHandle => (timeline ??= deps.createTimeline());
  const endTimeline = () => {
    timeline?.dispose();
    timeline = null;
  };

  return {
    handle(req) {
      switch (req.type) {
        case 'init':
          mode = 'editor';
          scenario?.dispose();
          endTimeline();
          deps.editor.handle(req);
          return;
        case 'load':
        case 'preview':
        case 'cancelPreview':
        case 'commit':
        case 'undo':
          deps.editor.handle(req);
          return;
        case 'heightLots':
          // The editor's own request; with no editor session the answer is null, as for a summary.
          if (mode === 'editor') deps.editor.handle(req);
          else deps.post({ type: 'heightLots', reqId: req.reqId, result: null });
          return;
        case 'initScenario':
          mode = 'scenario';
          deps.editor.dispose();
          endTimeline();
          scenarioHost().handle(req);
          return;
        case 'openTimeline':
          // One dataset in memory: every other host goes.
          mode = 'timeline';
          deps.editor.dispose();
          scenario?.dispose();
          scenario = null;
          timelineHost().handle(req);
          return;
        case 'setPolicy':
          if (mode === 'timeline') timelineHost().handle(req);
          else {
            const message = 'setPolicy needs a timeline session';
            deps.post({ type: 'error', rev: req.rev, code: 'bad-request', message });
          }
          return;
        case 'viewMonth':
        case 'resyncMap':
          if (mode === 'timeline') timelineHost().handle(req);
          return;
        case 'reroll':
        case 'setLevers':
          // Timeline mode has no scenario session: answered here, no scenario host is created.
          if (mode === 'timeline') {
            const message = `${req.type} needs a /sim scenario session`;
            deps.post({ type: 'error', rev: req.rev, code: 'bad-request', message });
          }
          // With no scenario host yet, a lazily created one answers `bad-request`.
          else scenarioHost().handle(req);
          return;
        case 'prefetch':
        case 'retryChunks':
          if (mode === 'scenario') scenarioHost().handle(req);
          else if (mode === 'timeline') timelineHost().handle(req);
          else deps.editor.handle(req);
          return;
        case 'parcelSummary':
          if (mode === 'timeline') timelineHost().handle(req as TimelineHostRequest);
          // `req` may be the editor's shape (no `day`); a scenario client always sends the full one.
          else if (mode === 'scenario') scenarioHost().handle(req as ScenarioRequest);
          // The editor's request shape has no `day` or `projectId`.
          else
            deps.editor.handle({ type: 'parcelSummary', reqId: req.reqId, parcelId: req.parcelId });
          return;
        case 'resolveBrush':
          if (mode === 'scenario') scenarioHost().handle(req);
          else if (mode === 'timeline') timelineHost().handle(req);
          else {
            const message = 'brushes need a /sim scenario session';
            deps.post({
              type: 'brushLots',
              reqId: req.reqId,
              result: { ok: false, reason: 'no-session', message }
            });
          }
          return;
        case 'brushCatalog':
          if (mode === 'scenario') scenarioHost().handle(req);
          else if (mode === 'timeline') timelineHost().handle(req);
          else deps.post({ type: 'brushCatalog', reqId: req.reqId, catalog: null });
          return;
        case 'lotOutlines':
          if (mode === 'scenario') scenarioHost().handle(req);
          else if (mode === 'timeline') timelineHost().handle(req);
          else {
            const message = 'outlines need a /sim scenario session';
            deps.post({
              type: 'lotOutlines',
              reqId: req.reqId,
              result: { ok: false, reason: 'no-session', message }
            });
          }
          return;
        case 'previewBuildings':
          if (mode === 'scenario') scenarioHost().handle(req);
          else if (mode === 'timeline') timelineHost().handle(req);
          else {
            const message = 'previews need a /sim scenario session';
            deps.post({
              type: 'previewBuildings',
              reqId: req.reqId,
              result: { ok: false, reason: 'no-session', message }
            });
          }
          return;
        case 'heightLids':
          if (mode === 'scenario') scenarioHost().handle(req);
          else if (mode === 'timeline') timelineHost().handle(req);
          else {
            const message = 'height lids need a /sim scenario session';
            deps.post({
              type: 'heightLids',
              reqId: req.reqId,
              result: { ok: false, reason: 'no-session', message }
            });
          }
          return;
        case 'lotAt':
          if (mode === 'scenario') scenarioHost().handle(req);
          else if (mode === 'timeline') timelineHost().handle(req);
          else {
            const message = 'lot lookup needs a /sim scenario session';
            deps.post({
              type: 'lotAt',
              reqId: req.reqId,
              result: { ok: false, reason: 'no-session', message }
            });
          }
          return;
        default: {
          const unreachable: never = req;
          void unreachable;
        }
      }
    }
  };
}
