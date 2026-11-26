import { describe, expect, it } from 'vitest';
import { createWorkerRouter } from './router';
import type { SimRequest, SimResponse } from './protocol';
import type { TimelineHostResponse, WorkerRequest } from './timeline-protocol';

function setup() {
  const log: string[] = [];
  const editorReqs: SimRequest[] = [];
  const timelineReqs: unknown[] = [];
  const posted: (SimResponse | TimelineHostResponse)[] = [];
  let timelines = 0;
  const router = createWorkerRouter({
    post: (msg) => posted.push(msg),
    editor: {
      handle: (r) => {
        log.push(`editor:${r.type}`);
        editorReqs.push(r);
      },
      dispose: () => log.push('editor:dispose')
    },
    createTimeline: () => {
      timelines++;
      log.push('timeline:create');
      return {
        handle: (r) => {
          log.push(`timeline:${r.type}`);
          timelineReqs.push(r);
        },
        dispose: () => log.push('timeline:dispose')
      };
    }
  });
  const send = (...rs: unknown[]) => rs.forEach((r) => router.handle(r as WorkerRequest));
  return { log, editorReqs, timelineReqs, posted, timelines: () => timelines, send };
}

const init = { type: 'init', rev: 1, manifest: {}, mode: 'max' };
const openTimeline = { type: 'openTimeline', rev: 2 };
const setPolicy = { type: 'setPolicy', rev: 3 };
const summary = { type: 'parcelSummary', reqId: 7, parcelId: 'p1', day: 5, projectId: 'x' };
const prefetch = { type: 'prefetch', bbox: [0, 0, 1, 1] };

describe('worker router', () => {
  it('sends the editor requests to the editor host and never creates the timeline host', () => {
    const t = setup();
    for (const type of ['load', 'preview', 'cancelPreview', 'commit', 'undo']) t.send({ type });
    expect(t.log).toEqual([
      'editor:load',
      'editor:preview',
      'editor:cancelPreview',
      'editor:commit',
      'editor:undo'
    ]);
    expect(t.timelines()).toBe(0);
  });

  it('init goes to the editor and creates no timeline host', () => {
    const t = setup();
    t.send(init);
    expect(t.log).toEqual(['editor:init']);
    expect(t.timelines()).toBe(0);
  });

  it('sends prefetch, retryChunks and parcelSummary to the editor before any openTimeline', () => {
    const t = setup();
    t.send(prefetch, { type: 'retryChunks' }, summary);
    expect(t.log).toEqual(['editor:prefetch', 'editor:retryChunks', 'editor:parcelSummary']);
    expect(t.timelines()).toBe(0);
  });

  it('passes a parcelSummary with a day to the editor in the editor shape', () => {
    const t = setup();
    t.send(summary);
    expect(t.editorReqs[0]).toStrictEqual({ type: 'parcelSummary', reqId: 7, parcelId: 'p1' });
  });

  it('sends the shared requests back to the editor after a later init', () => {
    const t = setup();
    t.send(openTimeline, init, prefetch, summary);
    expect(t.log.slice(-2)).toEqual(['editor:prefetch', 'editor:parcelSummary']);
    expect(t.editorReqs.at(-1)).toStrictEqual({
      type: 'parcelSummary',
      reqId: 7,
      parcelId: 'p1'
    });
  });

  const brush = { type: 'resolveBrush', reqId: 4, query: { kind: 'freehand', strokes: [] } };
  const catalog = { type: 'brushCatalog', reqId: 5 };

  it('answers resolveBrush and brushCatalog itself in editor mode: no-session', () => {
    const t = setup();
    t.send(brush, catalog, init, brush);
    expect(t.log).toEqual(['editor:init']);
    expect(t.timelines()).toBe(0);
    const noSession = {
      type: 'brushLots',
      reqId: 4,
      result: { ok: false, reason: 'no-session', message: expect.any(String) }
    };
    expect(t.posted).toEqual([
      noSession,
      { type: 'brushCatalog', reqId: 5, catalog: null },
      noSession
    ]);
  });

  const outlines = { type: 'lotOutlines', reqId: 6, lots: ['a'] };
  const preview = { type: 'previewBuildings', reqId: 7, lots: ['a'], stories: 8 };
  const lotAtReq = { type: 'lotAt', reqId: 9, point: [-122.4, 37.8] };
  const lids = { type: 'heightLids', reqId: 8, bbox: [0, 0, 0.01, 0.01] };

  it.each([
    ['lotOutlines', outlines],
    ['previewBuildings', preview],
    ['lotAt', lotAtReq],
    ['heightLids', lids]
  ])('answers %s itself in editor mode: no-session', (type, req) => {
    const t = setup();
    t.send(req);
    expect(t.log).toEqual([]);
    expect(t.timelines()).toBe(0);
    expect(t.posted).toEqual([
      {
        type,
        reqId: req.reqId,
        result: { ok: false, reason: 'no-session', message: expect.any(String) }
      }
    ]);
  });

  it('the no-session messages name the timeline session', () => {
    const t = setup();
    t.send(brush, outlines, preview, lotAtReq, lids);
    const messages = t.posted.map((m) => (m as { result: { message: string } }).result.message);
    expect(messages).toHaveLength(5);
    for (const m of messages) expect(m).toMatch(/ needs? a timeline session$/);
  });

  const heightLots = { type: 'heightLots', reqId: 9, outlineOf: null };

  it('sends heightLots to the editor in editor mode', () => {
    const t = setup();
    t.send(heightLots);
    expect(t.log).toEqual(['editor:heightLots']);
    expect(t.editorReqs[0]).toEqual(heightLots);
    expect(t.timelines()).toBe(0);
    expect(t.posted).toEqual([]);
  });

  it('ignores an unknown message such as initPlayback or playbackCard: nothing posted, no host touched', () => {
    const t = setup();
    t.send(
      { type: 'initPlayback', rev: 3, manifest: {}, plan: {}, sites: {} },
      { type: 'playbackCard', reqId: 1, projectId: 'x', day: 5 }
    );
    expect(t.log).toEqual([]);
    expect(t.posted).toEqual([]);
    expect(t.timelines()).toBe(0);
  });

  describe('timeline mode', () => {
    it('openTimeline disposes the editor, then goes to the timeline host', () => {
      const t = setup();
      t.send(openTimeline);
      expect(t.log).toEqual(['editor:dispose', 'timeline:create', 'timeline:openTimeline']);
    });

    it('init disposes the timeline host, then goes to the editor', () => {
      const t = setup();
      t.send(openTimeline);
      t.log.length = 0;
      t.send(init);
      expect(t.log).toEqual(['timeline:dispose', 'editor:init']);
    });

    it('creates the timeline host once and routes setPolicy, viewMonth and resyncMap to it', () => {
      const t = setup();
      t.send(openTimeline, setPolicy, { type: 'viewMonth', month: 1 }, { type: 'resyncMap' });
      expect(t.log.filter((l) => l === 'timeline:create')).toHaveLength(1);
      expect(t.log.slice(-3)).toEqual([
        'timeline:setPolicy',
        'timeline:viewMonth',
        'timeline:resyncMap'
      ]);
    });

    it('creates a new timeline host for an openTimeline after an init', () => {
      const t = setup();
      t.send(openTimeline, init, openTimeline);
      expect(t.timelines()).toBe(2);
    });

    it('shared requests go to the host of the latest init or openTimeline', () => {
      const t = setup();
      t.send(openTimeline, brush, prefetch, { type: 'retryChunks' }, summary);
      expect(t.log.slice(-4)).toEqual([
        'timeline:resolveBrush',
        'timeline:prefetch',
        'timeline:retryChunks',
        'timeline:parcelSummary'
      ]);
      expect(t.timelineReqs.at(-1)).toBe(summary);
      t.send(catalog, outlines, preview, lotAtReq, lids);
      expect(t.log.slice(-5)).toEqual([
        'timeline:brushCatalog',
        'timeline:lotOutlines',
        'timeline:previewBuildings',
        'timeline:lotAt',
        'timeline:heightLids'
      ]);
      t.send(init, brush);
      expect(t.log.slice(-1)).toEqual(['editor:init']);
      expect(t.posted).toHaveLength(1);
    });

    it('setPolicy outside timeline mode is bad-request', () => {
      const t = setup();
      t.send(setPolicy);
      expect(t.posted).toEqual([
        { type: 'error', rev: 3, code: 'bad-request', message: expect.any(String) }
      ]);
      t.send(openTimeline, init, setPolicy);
      expect(t.posted).toHaveLength(2);
      expect(t.log).not.toContain('timeline:setPolicy');
    });

    it('viewMonth and resyncMap outside timeline mode post nothing', () => {
      const t = setup();
      t.send({ type: 'viewMonth', month: 1 }, { type: 'resyncMap' });
      expect(t.posted).toEqual([]);
      expect(t.log).toEqual([]);
    });

    it('answers heightLots with null in timeline mode', () => {
      const t = setup();
      t.send(openTimeline, { type: 'heightLots', reqId: 4 });
      expect(t.posted).toEqual([{ type: 'heightLots', reqId: 4, result: null }]);
    });

    it('an initPlayback after openTimeline leaves the timeline host alone', () => {
      const t = setup();
      t.send(openTimeline);
      t.log.length = 0;
      t.send({ type: 'initPlayback' }, setPolicy);
      expect(t.log).toEqual(['timeline:setPolicy']);
      expect(t.posted).toEqual([]);
    });
  });
});
