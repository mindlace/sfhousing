import { describe, expect, it } from 'vitest';
import { DEFAULT_LEVERS } from './levers/types';
import { createWorkerRouter } from './router';
import type { SimRequest } from './protocol';
import type { ScenarioRequest, WorkerRequest } from './scenario/types';

function setup() {
  const log: string[] = [];
  const editorReqs: SimRequest[] = [];
  const scenarioReqs: ScenarioRequest[] = [];
  let created = 0;
  const router = createWorkerRouter({
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
    }
  });
  const send = (...rs: unknown[]) => rs.forEach((r) => router.handle(r as WorkerRequest));
  return { log, editorReqs, scenarioReqs, created: () => created, send };
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
});
