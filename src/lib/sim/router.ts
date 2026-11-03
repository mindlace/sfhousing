// The worker router (spec §4.1): the scenario host beside the unchanged editor host, behind the
// same Worker, plus the /lesscars playback host (lesscars Plan 2 Task 4). Worker-bundle module:
// DOM-free and $app-free.
import type { PlaybackHostRequest } from './lesscars/playback-host';
import type { PlaybackResponse } from './lesscars/types';
import type { SimRequest } from './protocol';
import type { ScenarioRequest, ScenarioResponse, WorkerRequest } from './scenario/types';

export interface RouterDeps {
  editor: { handle(r: SimRequest): void; dispose(): void };
  /**
   * Called on the first `initScenario` (or a `reroll` or `setLevers` outside playback mode that
   * arrives before one), and again on the next one after an `initPlayback` disposed it.
   */
  createScenario: () => { handle(r: ScenarioRequest): void; dispose(): void };
  /** Called on the first `initPlayback`, and again after `init` or `initScenario` disposed it. */
  createPlayback: () => { handle(r: PlaybackHostRequest): void; dispose(): void };
  /**
   * The router's own answers: brush, outline, preview and lid requests outside scenario mode
   * (`no-session`), and the requests playback mode does not serve (a null summary or card,
   * `bad-request`).
   */
  post(msg: ScenarioResponse | PlaybackResponse): void;
}

export function createWorkerRouter(deps: RouterDeps): { handle(req: WorkerRequest): void } {
  type ScenarioHandle = ReturnType<RouterDeps['createScenario']>;
  type PlaybackHandle = ReturnType<RouterDeps['createPlayback']>;
  let scenario: ScenarioHandle | null = null;
  let playback: PlaybackHandle | null = null;
  // Which host received the latest `init` / `initScenario` / `initPlayback`; the editor before any.
  let mode: 'editor' | 'scenario' | 'playback' = 'editor';

  const scenarioHost = (): ScenarioHandle => (scenario ??= deps.createScenario());
  const playbackHost = (): PlaybackHandle => (playback ??= deps.createPlayback());
  const endPlayback = () => {
    playback?.dispose();
    playback = null;
  };

  return {
    handle(req) {
      switch (req.type) {
        case 'init':
          mode = 'editor';
          scenario?.dispose();
          endPlayback();
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
          endPlayback();
          scenarioHost().handle(req);
          return;
        case 'initPlayback':
          mode = 'playback';
          deps.editor.dispose();
          scenario?.dispose();
          scenario = null;
          playbackHost().handle(req);
          return;
        case 'playbackCard':
          if (mode === 'playback') playbackHost().handle(req);
          else deps.post({ type: 'playbackCard', reqId: req.reqId, card: null });
          return;
        case 'reroll':
        case 'setLevers':
          // Playback mode has no scenario session: answered here, no scenario host is created.
          if (mode === 'playback') {
            const message = `${req.type} needs a /sim scenario session`;
            deps.post({ type: 'error', rev: req.rev, code: 'bad-request', message });
          }
          // With no scenario host yet, a lazily created one answers `bad-request`.
          else scenarioHost().handle(req);
          return;
        case 'prefetch':
        case 'retryChunks':
          if (mode === 'scenario') scenarioHost().handle(req);
          else if (mode === 'playback') playbackHost().handle(req);
          else deps.editor.handle(req);
          return;
        case 'parcelSummary':
          if (mode === 'playback') {
            deps.post({ type: 'parcelSummary', reqId: req.reqId, summary: null });
          }
          // `req` may be the editor's shape (no `day`); a scenario client always sends the full one.
          else if (mode === 'scenario') scenarioHost().handle(req as ScenarioRequest);
          // The editor's request shape has no `day` or `projectId`.
          else
            deps.editor.handle({ type: 'parcelSummary', reqId: req.reqId, parcelId: req.parcelId });
          return;
        case 'resolveBrush':
          if (mode === 'scenario') scenarioHost().handle(req);
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
          else deps.post({ type: 'brushCatalog', reqId: req.reqId, catalog: null });
          return;
        case 'lotOutlines':
          if (mode === 'scenario') scenarioHost().handle(req);
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
