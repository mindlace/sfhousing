// The worker router (spec §4.1): the unchanged editor host and the timeline host, behind the same
// Worker. Worker-bundle module: DOM-free and $app-free.
import type { SimRequest, SimResponse } from './protocol';
import type { TimelineHostRequest, TimelineHostResponse, WorkerRequest } from './timeline-protocol';

type WorkerMode = 'editor' | 'timeline';

export interface RouterDeps {
  editor: { handle(r: SimRequest): void; dispose(): void };
  /**
   * Called on the first `openTimeline` (timeline mode), and again on the next one after an
   * `init` disposed it.
   */
  createTimeline: () => { handle(r: TimelineHostRequest): void; dispose(): void };
  /**
   * The router's own answers: brush, outline, preview, lid and lot requests outside timeline mode
   * (`no-session`), `bad-request` errors, and the editor's `heightLots` outside editor mode
   * (`result: null`).
   */
  post(msg: SimResponse | TimelineHostResponse): void;
}

export function createWorkerRouter(deps: RouterDeps): {
  handle(req: WorkerRequest): void;
} {
  type TimelineHandle = ReturnType<RouterDeps['createTimeline']>;
  let timeline: TimelineHandle | null = null;
  // Which host received the latest `init` / `openTimeline`; the editor before any.
  let mode: WorkerMode = 'editor';

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
        case 'openTimeline':
          // One dataset in memory: the editor host goes.
          mode = 'timeline';
          deps.editor.dispose();
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
        case 'prefetch':
        case 'retryChunks':
          if (mode === 'timeline') timelineHost().handle(req);
          else deps.editor.handle(req);
          return;
        case 'parcelSummary':
          if (mode === 'timeline') timelineHost().handle(req as TimelineHostRequest);
          // `req` may be the editor's shape (no `day`).
          else
            deps.editor.handle({ type: 'parcelSummary', reqId: req.reqId, parcelId: req.parcelId });
          return;
        case 'resolveBrush':
          if (mode === 'timeline') timelineHost().handle(req);
          else {
            const message = 'brushes need a timeline session';
            deps.post({
              type: 'brushLots',
              reqId: req.reqId,
              result: { ok: false, reason: 'no-session', message }
            });
          }
          return;
        case 'brushCatalog':
          if (mode === 'timeline') timelineHost().handle(req);
          else deps.post({ type: 'brushCatalog', reqId: req.reqId, catalog: null });
          return;
        case 'lotOutlines':
          if (mode === 'timeline') timelineHost().handle(req);
          else {
            const message = 'outlines need a timeline session';
            deps.post({
              type: 'lotOutlines',
              reqId: req.reqId,
              result: { ok: false, reason: 'no-session', message }
            });
          }
          return;
        case 'previewBuildings':
          if (mode === 'timeline') timelineHost().handle(req);
          else {
            const message = 'previews need a timeline session';
            deps.post({
              type: 'previewBuildings',
              reqId: req.reqId,
              result: { ok: false, reason: 'no-session', message }
            });
          }
          return;
        case 'heightLids':
          if (mode === 'timeline') timelineHost().handle(req);
          else {
            const message = 'height lids need a timeline session';
            deps.post({
              type: 'heightLids',
              reqId: req.reqId,
              result: { ok: false, reason: 'no-session', message }
            });
          }
          return;
        case 'lotAt':
          if (mode === 'timeline') timelineHost().handle(req);
          else {
            const message = 'lot lookup needs a timeline session';
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
