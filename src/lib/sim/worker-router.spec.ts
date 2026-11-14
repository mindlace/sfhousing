import { describe, expect, it } from 'vitest';
import { DEFAULT_LEVERS } from './levers/types';
import { createWorkerRouter } from './router';
import type { SimRequest, SimResponse } from './protocol';
import type { PlaybackResponse } from './lesscars/types';
import type { TimelineHostResponse } from './timeline-protocol';
import type { ScenarioRequest, ScenarioResponse, WorkerRequest } from './scenario/types';

function setup() {
  const log: string[] = [];
  const editorReqs: SimRequest[] = [];
  const scenarioReqs: ScenarioRequest[] = [];
  const posted: (ScenarioResponse | PlaybackResponse | SimResponse | TimelineHostResponse)[] = [];
  let created = 0;
  const router = createWorkerRouter({
    post: (msg) => posted.push(msg),
    editor: {
      handle: (r) => {
        log.push(`editor:${r.type}`);
        editorReqs.push(r);
      },
      dispose: () => log.push('editor:dispose')
    },
    createScenario: () => {
      created++;
      log.push('scenario:create');
      return {
        handle: (r) => {
          log.push(`scenario:${r.type}`);
          scenarioReqs.push(r);
        },
        dispose: () => log.push('scenario:dispose')
      };
    },
    createTimeline: () => {
      log.push('timeline:create');
      return {
        handle: (r) => log.push(`timeline:${r.type}`),
        dispose: () => log.push('timeline:dispose')
      };
    },
    createPlayback: () => {
      log.push('playback:create');
      return {
        handle: (r) => log.push(`playback:${r.type}`),
        dispose: () => log.push('playback:dispose')
      };
    }
  });
  const send = (...rs: unknown[]) => rs.forEach((r) => router.handle(r as WorkerRequest));
  return { log, editorReqs, scenarioReqs, posted, created: () => created, send };
}

const init = { type: 'init', rev: 1, manifest: {}, mode: 'max' };
const initScenario = {
  type: 'initScenario',
  rev: 2,
  manifest: {},
  scenario: 'fzp',
  seed: null,
  horizon: 100
};
const summary = { type: 'parcelSummary', reqId: 7, parcelId: 'p1', day: 5, projectId: 'x' };
const prefetch = { type: 'prefetch', bbox: [0, 0, 1, 1] };

describe('worker router', () => {
  it('sends the editor requests to the editor host and never creates the scenario host', () => {
    const t = setup();
    for (const type of ['load', 'preview', 'cancelPreview', 'commit', 'undo']) t.send({ type });
    expect(t.log).toEqual([
      'editor:load',
      'editor:preview',
      'editor:cancelPreview',
      'editor:commit',
      'editor:undo'
    ]);
    expect(t.created()).toBe(0);
  });

  it('creates the scenario host on the first initScenario only, and disposes the editor', () => {
    const t = setup();
    t.send(initScenario, { ...initScenario, rev: 3 });
    expect(t.log).toEqual([
      'editor:dispose',
      'scenario:create',
      'scenario:initScenario',
      'editor:dispose',
      'scenario:initScenario'
    ]);
    expect(t.created()).toBe(1);
  });

  it('init after initScenario disposes the scenario host, then goes to the editor', () => {
    const t = setup();
    t.send(initScenario, init);
    expect(t.log.slice(-2)).toEqual(['scenario:dispose', 'editor:init']);
  });

  it('init with no scenario host does not create one', () => {
    const t = setup();
    t.send(init);
    expect(t.log).toEqual(['editor:init']);
    expect(t.created()).toBe(0);
  });

  it('routes a reroll to the scenario host, creating it lazily if absent', () => {
    const t = setup();
    t.send({ type: 'reroll', rev: 1, seed: 3 });
    expect(t.log).toEqual(['scenario:create', 'scenario:reroll']);
    t.send({ type: 'reroll', rev: 2, seed: 4 });
    expect(t.created()).toBe(1);
  });

  it('routes setLevers to the scenario host, creating it lazily if absent', () => {
    const t = setup();
    const levers = structuredClone(DEFAULT_LEVERS);
    t.send({ type: 'setLevers', rev: 1, levers });
    expect(t.log).toEqual(['scenario:create', 'scenario:setLevers']);
  });

  it('a reroll does not change which host the shared requests go to', () => {
    const t = setup();
    t.send(init, { type: 'reroll', rev: 2, seed: 1 }, prefetch);
    expect(t.log.slice(-1)).toEqual(['editor:prefetch']);
  });

  it('sends prefetch, retryChunks and parcelSummary to the editor before any init', () => {
    const t = setup();
    t.send(prefetch, { type: 'retryChunks' }, summary);
    expect(t.log).toEqual(['editor:prefetch', 'editor:retryChunks', 'editor:parcelSummary']);
    expect(t.created()).toBe(0);
  });

  it('passes a scenario-style parcelSummary to the editor in the editor shape', () => {
    const t = setup();
    t.send(summary);
    expect(t.editorReqs[0]).toStrictEqual({ type: 'parcelSummary', reqId: 7, parcelId: 'p1' });
  });

  it('sends the shared requests to the scenario host after initScenario, unchanged', () => {
    const t = setup();
    t.send(initScenario, prefetch, { type: 'retryChunks' }, summary);
    expect(t.log.slice(-3)).toEqual([
      'scenario:prefetch',
      'scenario:retryChunks',
      'scenario:parcelSummary'
    ]);
    expect(t.scenarioReqs.at(-1)).toBe(summary);
  });

  it('sends the shared requests back to the editor after a later init', () => {
    const t = setup();
    t.send(initScenario, init, prefetch, summary);
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
    expect(t.created()).toBe(0);
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

  it('sends resolveBrush and brushCatalog to the scenario host after initScenario', () => {
    const t = setup();
    t.send(initScenario, brush, catalog, init, brush);
    expect(t.log).toEqual([
      'editor:dispose',
      'scenario:create',
      'scenario:initScenario',
      'scenario:resolveBrush',
      'scenario:brushCatalog',
      'scenario:dispose',
      'editor:init'
    ]);
    expect(t.scenarioReqs.slice(1)).toEqual([brush, catalog]);
    expect(t.posted).toHaveLength(1); // the last, in editor mode
  });

  const outlines = { type: 'lotOutlines', reqId: 6, lots: ['a'] };

  it('answers lotOutlines itself in editor mode: no-session; the scenario host otherwise', () => {
    const t = setup();
    t.send(outlines);
    expect(t.created()).toBe(0);
    expect(t.posted).toEqual([
      {
        type: 'lotOutlines',
        reqId: 6,
        result: { ok: false, reason: 'no-session', message: expect.any(String) }
      }
    ]);
    const u = setup();
    u.send(initScenario, outlines);
    expect(u.log).toEqual([
      'editor:dispose',
      'scenario:create',
      'scenario:initScenario',
      'scenario:lotOutlines'
    ]);
    expect(u.scenarioReqs[1]).toEqual(outlines);
  });

  const opLots = { type: 'opLots', reqId: 9, opIds: ['a'], outlines: false };

  it('sends opLots to the editor in editor mode and answers result null elsewhere', () => {
    const t = setup();
    t.send(opLots);
    expect(t.log).toEqual(['editor:opLots']);
    expect(t.editorReqs[0]).toEqual(opLots);
    expect(t.created()).toBe(0);
    expect(t.posted).toEqual([]);

    const u = setup();
    u.send(initScenario, opLots);
    expect(u.log).not.toContain('editor:opLots');
    expect(u.scenarioReqs).toHaveLength(1);
    expect(u.posted).toEqual([{ type: 'opLots', reqId: 9, result: null }]);

    const v = setup();
    v.send({ type: 'initPlayback', rev: 3, manifest: {}, plan: {}, sites: {} }, opLots);
    expect(v.log).not.toContain('editor:opLots');
    expect(v.posted).toEqual([{ type: 'opLots', reqId: 9, result: null }]);
  });

  const preview = { type: 'previewBuildings', reqId: 7, lots: ['a'], stories: 8 };

  it('answers previewBuildings itself in editor mode: no-session; the scenario host otherwise', () => {
    const t = setup();
    t.send(preview);
    expect(t.created()).toBe(0);
    expect(t.posted).toEqual([
      {
        type: 'previewBuildings',
        reqId: 7,
        result: { ok: false, reason: 'no-session', message: expect.any(String) }
      }
    ]);
    const u = setup();
    u.send(initScenario, preview);
    expect(u.log).toEqual([
      'editor:dispose',
      'scenario:create',
      'scenario:initScenario',
      'scenario:previewBuildings'
    ]);
    expect(u.scenarioReqs[1]).toEqual(preview);
  });

  const lotAtReq = { type: 'lotAt', reqId: 9, point: [-122.4, 37.8] };

  it('answers lotAt itself in editor mode: no-session; the scenario host otherwise', () => {
    const t = setup();
    t.send(lotAtReq);
    expect(t.created()).toBe(0);
    expect(t.posted).toEqual([
      {
        type: 'lotAt',
        reqId: 9,
        result: { ok: false, reason: 'no-session', message: expect.any(String) }
      }
    ]);
    const u = setup();
    u.send(initScenario, lotAtReq);
    expect(u.log).toEqual([
      'editor:dispose',
      'scenario:create',
      'scenario:initScenario',
      'scenario:lotAt'
    ]);
    expect(u.scenarioReqs[1]).toEqual(lotAtReq);
  });

  const lids = { type: 'heightLids', reqId: 8, bbox: [0, 0, 0.01, 0.01] };

  it('answers heightLids itself in editor mode: no-session; the scenario host otherwise', () => {
    const t = setup();
    t.send(lids);
    expect(t.created()).toBe(0);
    expect(t.posted).toEqual([
      {
        type: 'heightLids',
        reqId: 8,
        result: { ok: false, reason: 'no-session', message: expect.any(String) }
      }
    ]);
    const u = setup();
    u.send(initScenario, lids);
    expect(u.log).toEqual([
      'editor:dispose',
      'scenario:create',
      'scenario:initScenario',
      'scenario:heightLids'
    ]);
    expect(u.scenarioReqs[1]).toEqual(lids);
  });

  it('sends the shared requests to the scenario host after init then initScenario', () => {
    const t = setup();
    t.send(init, initScenario, prefetch);
    expect(t.log).toEqual([
      'editor:init',
      'editor:dispose',
      'scenario:create',
      'scenario:initScenario',
      'scenario:prefetch'
    ]);
  });

  const initPlayback = { type: 'initPlayback', rev: 3, manifest: {}, plan: {}, sites: {} };

  it('initPlayback disposes the editor and the scenario host, then shared requests go to playback', () => {
    const t = setup();
    t.send(initScenario, initPlayback, prefetch, { type: 'retryChunks' });
    expect(t.log).toEqual([
      'editor:dispose',
      'scenario:create',
      'scenario:initScenario',
      'editor:dispose',
      'scenario:dispose',
      'playback:create',
      'playback:initPlayback',
      'playback:prefetch',
      'playback:retryChunks'
    ]);
  });

  it('creates the playback host once across playback inits', () => {
    const t = setup();
    t.send(initPlayback, { ...initPlayback, rev: 4 });
    expect(t.log).toEqual([
      'editor:dispose',
      'playback:create',
      'playback:initPlayback',
      'editor:dispose',
      'playback:initPlayback'
    ]);
  });

  it('init and initScenario dispose the playback host', () => {
    const t = setup();
    t.send(initPlayback, init);
    expect(t.log.slice(-2)).toEqual(['playback:dispose', 'editor:init']);
    t.send(initPlayback, initScenario);
    expect(t.log.slice(-4)).toEqual([
      'editor:dispose',
      'playback:dispose',
      'scenario:create',
      'scenario:initScenario'
    ]);
  });

  it('after init, the shared requests go back to the editor', () => {
    const t = setup();
    t.send(initPlayback, init, prefetch);
    expect(t.log.at(-1)).toBe('editor:prefetch');
  });

  it('playbackCard outside playback mode answers card null; inside, the host gets it', () => {
    const t = setup();
    t.send({ type: 'playbackCard', reqId: 1, projectId: 'x', day: 5 });
    expect(t.posted).toEqual([{ type: 'playbackCard', reqId: 1, card: null }]);
    t.send(initPlayback, { type: 'playbackCard', reqId: 2, projectId: 'x', day: 5 });
    expect(t.log.at(-1)).toBe('playback:playbackCard');
    t.send(initScenario, { type: 'playbackCard', reqId: 3, projectId: 'x', day: 5 });
    expect(t.posted.at(-1)).toEqual({ type: 'playbackCard', reqId: 3, card: null });
  });

  it('in playback mode: parcelSummary answers null; reroll and setLevers answer bad-request without a scenario host', () => {
    const t = setup();
    t.send(
      initPlayback,
      summary,
      { type: 'reroll', rev: 4, seed: 1 },
      { type: 'setLevers', rev: 5, levers: DEFAULT_LEVERS }
    );
    expect(t.posted).toEqual([
      { type: 'parcelSummary', reqId: 7, summary: null },
      {
        type: 'error',
        rev: 4,
        code: 'bad-request',
        message: 'reroll needs a /sim scenario session'
      },
      {
        type: 'error',
        rev: 5,
        code: 'bad-request',
        message: 'setLevers needs a /sim scenario session'
      }
    ]);
    expect(t.created()).toBe(0);
  });

  it('in playback mode, brush requests take the no-session answers', () => {
    const t = setup();
    t.send(initPlayback, { type: 'brushCatalog', reqId: 9 }, brush, outlines, preview);
    expect(t.posted).toEqual([
      { type: 'brushCatalog', reqId: 9, catalog: null },
      {
        type: 'brushLots',
        reqId: 4,
        result: { ok: false, reason: 'no-session', message: expect.any(String) }
      },
      {
        type: 'lotOutlines',
        reqId: 6,
        result: { ok: false, reason: 'no-session', message: expect.any(String) }
      },
      {
        type: 'previewBuildings',
        reqId: 7,
        result: { ok: false, reason: 'no-session', message: expect.any(String) }
      }
    ]);
    expect(t.created()).toBe(0);
  });

  describe('timeline mode', () => {
    const openTimeline = { type: 'openTimeline', rev: 1 };
    const setPolicy = { type: 'setPolicy', rev: 2 };
    const brush = { type: 'resolveBrush', reqId: 3, query: {} };

    it('openTimeline disposes the editor and scenario hosts, then goes to the timeline host', () => {
      const t = setup();
      t.send(initScenario);
      t.log.length = 0;
      t.send(openTimeline);
      expect(t.log).toEqual([
        'editor:dispose',
        'scenario:dispose',
        'timeline:create',
        'timeline:openTimeline'
      ]);
    });

    it('openTimeline disposes the playback host', () => {
      const t = setup();
      t.send({ type: 'initPlayback' });
      t.log.length = 0;
      t.send(openTimeline);
      expect(t.log).toEqual([
        'editor:dispose',
        'playback:dispose',
        'timeline:create',
        'timeline:openTimeline'
      ]);
    });

    it('init, initScenario and initPlayback dispose the timeline host', () => {
      for (const next of [init, initScenario, { type: 'initPlayback' }]) {
        const t = setup();
        t.send(openTimeline);
        t.log.length = 0;
        t.send(next);
        expect(t.log).toContain('timeline:dispose');
      }
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

    it('shared requests go to the host of the latest init', () => {
      const t = setup();
      t.send(openTimeline, brush, prefetch, summary);
      expect(t.log.slice(-3)).toEqual([
        'timeline:resolveBrush',
        'timeline:prefetch',
        'timeline:parcelSummary'
      ]);
      t.send(initScenario, brush);
      expect(t.log.slice(-1)).toEqual(['scenario:resolveBrush']);
      t.send(openTimeline, brush);
      expect(t.log.slice(-1)).toEqual(['timeline:resolveBrush']);
    });

    it('setPolicy outside timeline mode is bad-request', () => {
      const t = setup();
      t.send(setPolicy);
      expect(t.posted).toEqual([
        { type: 'error', rev: 2, code: 'bad-request', message: expect.any(String) }
      ]);
      t.send(initScenario, setPolicy);
      expect(t.posted).toHaveLength(2);
      expect(t.log).not.toContain('timeline:create');
    });

    it('viewMonth and resyncMap outside timeline mode post nothing', () => {
      const t = setup();
      t.send({ type: 'viewMonth', month: 1 }, { type: 'resyncMap' });
      expect(t.posted).toEqual([]);
      expect(t.log).toEqual([]);
    });

    it('reroll and setLevers in timeline mode are bad-request and create no scenario host', () => {
      const t = setup();
      t.send(openTimeline, { type: 'reroll', rev: 5, seed: 1 });
      expect(t.posted).toMatchObject([{ type: 'error', rev: 5, code: 'bad-request' }]);
      expect(t.created()).toBe(0);
    });

    it('answers opLots with null in timeline mode', () => {
      const t = setup();
      t.send(openTimeline, { type: 'opLots', reqId: 4 });
      expect(t.posted).toEqual([{ type: 'opLots', reqId: 4, result: null }]);
    });
  });
});
