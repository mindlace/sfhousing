import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Layer } from '@deck.gl/core';
import { OPS_MAX, emptyPlan, quantize, type Plan, type PlanOp } from '$lib/plan';
import type { DiffResponse, OpStats } from '$lib/sim/protocol';
import {
  BrushController,
  type BrushControllerDeps,
  type ControllerMap
} from './BrushController.svelte';
import { createEditor, type Editor } from './editor.svelte';
import { MSG, strokeMessage } from './messages';
import type { OverlayCtors } from './overlay';
import { BrushState } from './state.svelte';

type Ev = 'move' | 'moveend' | 'zoom';

function fakeCtors(): OverlayCtors {
  const mk = () =>
    class {
      props: Record<string, unknown>;
      id: string;
      constructor(props: Record<string, unknown>) {
        this.props = props;
        this.id = props.id as string;
      }
    } as unknown as new (props: Record<string, unknown>) => Layer;
  return { ScatterplotLayer: mk(), PathLayer: mk() };
}

interface Fixture {
  box: HTMLDivElement;
  canvas: HTMLCanvasElement;
  map: ControllerMap & { zoom: number; fire(ev: Ev): void; outOfBox: boolean };
  handle: { pan: boolean[]; overlays: Layer[][] };
  client: {
    rev: number;
    previews: { rev: number; op: PlanOp }[];
    commits: { rev: number; op: PlanOp }[];
    cancels: number[];
    undos: string[];
    prefetches: number[][];
  };
  editor: Editor;
  state: BrushState;
  crosshair: boolean[];
  flushRaf(): number;
  ctl: BrushController;
}

let fx: Fixture;

function setup(opts: { plan?: Plan } = {}): Fixture {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px';
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.width = 400;
  canvas.height = 300;
  box.appendChild(canvas);
  document.body.appendChild(box);

  const listeners = new Map<Ev, Set<() => void>>();
  const map: Fixture['map'] = {
    zoom: 17,
    outOfBox: false,
    getCanvas: () => canvas,
    getCanvasContainer: () => box,
    unproject: ([x, y]) =>
      map.outOfBox ? { lng: 0, lat: 0 } : { lng: -122.42 + x * 1e-5, lat: 37.76 - y * 1e-5 },
    getCenter: () => ({ lng: -122.42, lat: 37.76 }),
    getZoom: () => map.zoom,
    getBounds: () => ({
      getWest: () => -122.43,
      getSouth: () => 37.75,
      getEast: () => -122.41,
      getNorth: () => 37.77
    }),
    on: (ev, fn) => {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev)!.add(fn);
    },
    off: (ev, fn) => void listeners.get(ev)?.delete(fn),
    fire: (ev) => listeners.get(ev)?.forEach((fn) => fn())
  };

  const handle: Fixture['handle'] = { pan: [], overlays: [] };
  const client: Fixture['client'] = {
    rev: 0,
    previews: [],
    commits: [],
    cancels: [],
    undos: [],
    prefetches: []
  };
  const clientApi: BrushControllerDeps['client'] = {
    datasetVersion: 'fixture-0',
    preview: (op) => {
      const rev = ++client.rev;
      client.previews.push({ rev, op: structuredClone(op) });
      return rev;
    },
    cancelPreview: () => {
      const rev = ++client.rev;
      client.cancels.push(rev);
      return rev;
    },
    commit: (op) => {
      const rev = ++client.rev;
      client.commits.push({ rev, op: structuredClone(op) });
      return rev;
    },
    undo: (id) => {
      client.undos.push(id);
      return ++client.rev;
    },
    prefetch: (bbox) => void client.prefetches.push([...bbox])
  } as BrushControllerDeps['client'];

  const editor = createEditor(opts.plan ?? emptyPlan('fixture-0'));
  const state = new BrushState({ fine: true, storage: null });
  state.phase = 'ready';

  let seq = 0;
  const rafQ = new Map<number, () => void>();
  const flushRaf = () => {
    const fns = [...rafQ.values()];
    rafQ.clear();
    fns.forEach((f) => f());
    return fns.length;
  };
  const crosshair: boolean[] = [];

  const ctl = new BrushController({
    handle: {
      setPanEnabled: (b) => void handle.pan.push(b),
      setOverlayLayers: (l) => void handle.overlays.push(l)
    },
    map,
    client: clientApi,
    editor,
    state,
    layers: fakeCtors(),
    raf: (cb) => {
      rafQ.set(++seq, cb);
      return seq;
    },
    cancelRaf: (h) => void rafQ.delete(h),
    dark: () => false,
    onCrosshair: (v) => void crosshair.push(v)
  });
  ctl.attach();
  flushSync();
  return { box, canvas, map, handle, client, editor, state, crosshair, flushRaf, ctl };
}

interface P {
  id?: number;
  type?: string;
  button?: number;
  primary?: boolean;
}

function ptr(kind: string, x: number, y: number, p: P = {}): PointerEvent {
  const e = new PointerEvent(kind, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    pointerId: p.id ?? 1,
    pointerType: p.type ?? 'mouse',
    button: p.button ?? (kind === 'pointermove' ? -1 : 0),
    isPrimary: p.primary ?? true
  });
  fx.canvas.dispatchEvent(e);
  return e;
}
const down = (x: number, y: number, p?: P) => ptr('pointerdown', x, y, p);
const move = (x: number, y: number, p?: P) => ptr('pointermove', x, y, p);
const up = (x: number, y: number, p?: P) => ptr('pointerup', x, y, p);

function key(k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}
function keyUp(k: string, target: EventTarget = document.body) {
  const e = new KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

function diff(rev: number, phase: DiffResponse['phase'], stats?: OpStats): DiffResponse {
  return { type: 'diff', rev, phase, stats, complete: true } as unknown as DiffResponse;
}

/** A short drag from (0,0) to (60,0), acked so nothing is in flight, then pointer-up. */
function stroke(p: P = {}) {
  down(0, 0, p);
  for (let x = 10; x <= 60; x += 10) move(x, 0, p);
  fx.flushRaf();
  const last = fx.client.previews.at(-1);
  if (last) fx.ctl.onDiff(diff(last.rev, 'preview'), false);
  up(60, 0, p);
}

const lastPan = () => fx.handle.pan.at(-1);
const ids = (layers: Layer[] | undefined) => (layers ?? []).map((l) => l.id);

beforeEach(() => {
  fx = setup();
});

afterEach(() => {
  fx.ctl.destroy();
  fx.state.destroy();
  fx.box.remove();
});

describe('BrushController drag, previews and commit', () => {
  it('sends at most one preview in flight, once per raf, and commits the last preview path', () => {
    down(0, 0);
    expect(fx.ctl.stroking).toBe(true);
    let x = 0;
    const moves = (n: number) => {
      for (let i = 0; i < n; i++) move((x += 10), 0);
    };

    moves(3);
    fx.flushRaf();
    expect(fx.client.previews).toHaveLength(1);
    const first = fx.client.previews[0].rev;

    moves(3);
    fx.flushRaf();
    expect(fx.client.previews).toHaveLength(1); // still in flight

    fx.ctl.onDiff(diff(first, 'preview'), false);
    moves(3);
    fx.flushRaf();
    expect(fx.client.previews).toHaveLength(2);

    moves(1); // x = 100
    fx.flushRaf();
    expect(fx.client.previews).toHaveLength(2);
    fx.ctl.onDiff(diff(fx.client.previews[1].rev, 'preview'), false);
    fx.flushRaf();
    expect(fx.client.previews).toHaveLength(3);
    fx.ctl.onDiff(diff(fx.client.previews[2].rev, 'preview'), false);
    expect(fx.flushRaf()).toBe(0);

    up(100, 0);
    expect(fx.ctl.stroking).toBe(false);
    expect(fx.editor.plan.ops).toHaveLength(1);
    const op = fx.editor.plan.ops[0];
    expect(fx.client.commits).toHaveLength(1);
    expect(fx.client.commits[0].op).toEqual(op);
    expect(fx.ctl.lastCommitRev).toBe(fx.client.commits[0].rev);
    expect(fx.ctl.markedCommitRev).toBe(fx.client.commits[0].rev);
    // Acceptance 2: the committed op is the last preview.
    expect(op.path).toEqual(fx.client.previews[2].op.path);
    expect(op.id).toBe(fx.client.previews[2].op.id);
    expect(op.kind).toBe('paint');
    expect(op.kind === 'paint' && op.stories).toBe(6);
    expect(Number.isInteger(op.radiusM)).toBe(true);
    expect(fx.client.cancels).toHaveLength(0);
  });

  it('freezes an integer radius and the stories at pointer-down', () => {
    fx.state.setRadius(33.7);
    down(0, 0);
    move(30, 0);
    key(']');
    key('=');
    up(30, 0);
    const op = fx.editor.plan.ops[0];
    expect(op.radiusM).toBe(34);
    expect(Number.isInteger(op.radiusM)).toBe(true);
    expect(op.kind === 'paint' && op.stories).toBe(6);
    expect(fx.state.stories).toBe(7);
  });

  it('builds erase ops without a stories key', () => {
    fx.ctl.setTool('erase');
    stroke();
    const op = fx.editor.plan.ops[0];
    expect(op.kind).toBe('erase');
    expect('stories' in op).toBe(false);
    expect('stories' in fx.client.commits[0].op).toBe(false);
  });

  it('previews the final tail before committing when pointer-up lands in the same frame (F-4)', () => {
    down(0, 0);
    move(30, 0);
    fx.flushRaf();
    fx.ctl.onDiff(diff(fx.client.previews[0].rev, 'preview'), false); // acked: none in flight
    move(60, 0);
    up(60, 0); // no raf flush: the tail (30 → 60) was never previewed by the frame loop
    const last = fx.client.previews.at(-1)!;
    const commit = fx.client.commits[0];
    expect(fx.client.previews).toHaveLength(2);
    expect(last.op.path).toEqual(commit.op.path);
    expect(last.op.id).toBe(commit.op.id);
    expect(last.rev).toBeLessThan(commit.rev);
    expect(fx.flushRaf()).toBe(0); // nothing more goes out for the finished stroke
  });

  it('previews the final tail before committing while a preview is in flight (F-4)', () => {
    down(0, 0);
    move(30, 0);
    fx.flushRaf(); // preview 1 in flight, never acked
    move(60, 0);
    fx.flushRaf(); // held back by the one-in-flight limit
    expect(fx.client.previews).toHaveLength(1);
    up(60, 0);
    expect(fx.client.previews).toHaveLength(2);
    expect(fx.client.previews[1].op.path).toEqual(fx.client.commits[0].op.path);
    expect(fx.client.previews[1].rev).toBeLessThan(fx.client.commits[0].rev);
  });

  it('sends no extra preview when the last preview already shows the whole path', () => {
    down(0, 0);
    move(60, 0);
    fx.flushRaf();
    fx.ctl.onDiff(diff(fx.client.previews[0].rev, 'preview'), false);
    up(60, 0);
    expect(fx.client.previews).toHaveLength(1);
    expect(fx.client.previews[0].op.path).toEqual(fx.client.commits[0].op.path);
  });

  it('commits a one-point stamp for a click with no movement', () => {
    down(5, 5);
    up(5, 5);
    expect(fx.editor.plan.ops).toHaveLength(1);
    expect(fx.editor.plan.ops[0].path).toHaveLength(1);
  });

  it('splits a stroke that reaches PATH_MAX_POINTS into two continuous ops', () => {
    fx.state.setRadius(5); // spacing 2.5 m; 3 px ≈ 2.6 m, so every move is kept
    down(0, 0);
    for (let i = 1; i <= 2010; i++) move(i * 3, (i % 2) * 0.5);
    expect(fx.editor.plan.ops).toHaveLength(1);
    const a = fx.editor.plan.ops[0];
    expect(a.path).toHaveLength(2000);
    up(2010 * 3, 0);
    expect(fx.editor.plan.ops).toHaveLength(2);
    const b = fx.editor.plan.ops[1];
    expect(b.id).not.toBe(a.id);
    expect(b.path[0]).toEqual(a.path.at(-1));
    expect(b.radiusM).toBe(5);
  });

  it('produces no op for an out-of-bbox stroke', () => {
    fx.map.outOfBox = true;
    stroke();
    expect(fx.editor.plan.ops).toHaveLength(0);
    expect(fx.client.commits).toHaveLength(0);
    expect(fx.client.previews).toHaveLength(0);
    expect(fx.client.cancels).toHaveLength(0);
  });

  it('sends cancelPreview on cancel only when a preview was sent', () => {
    down(0, 0);
    move(30, 0);
    key('Escape');
    expect(fx.client.cancels).toHaveLength(0);
    down(0, 0);
    move(30, 0);
    fx.flushRaf();
    key('Escape');
    expect(fx.client.cancels).toHaveLength(1);
    expect(fx.editor.plan.ops).toHaveLength(0);
  });

  it('refuses a commit at OPS_MAX, cancels the preview and announces', () => {
    fx.ctl.destroy();
    fx.box.remove();
    const ops: PlanOp[] = Array.from({ length: OPS_MAX }, (_, i) => ({
      kind: 'erase',
      radiusM: 5,
      path: [[-122.41, 37.76]],
      id: `o${i}`
    }));
    fx = setup({ plan: { schema: 1, datasetVersion: 'fixture-0', ops } });
    stroke();
    expect(fx.editor.plan.ops).toHaveLength(OPS_MAX);
    expect(fx.client.commits).toHaveLength(0);
    expect(fx.client.cancels).toHaveLength(1);
    expect(fx.state.announcement).toBe(MSG.tooLarge);
    expect(fx.ctl.stroking).toBe(false);
  });

  it('announces the commit stats for the awaited op only', () => {
    stroke();
    const op = fx.editor.plan.ops[0];
    const stats: OpStats = {
      opId: op.id,
      kind: 'paint',
      stories: 6,
      covered: 3,
      ineligible: 0,
      underwater: 0,
      built: 2,
      notBigger: 1,
      removed: 0,
      partial: false
    };
    fx.ctl.onDiff(diff(fx.ctl.lastCommitRev!, 'commit', { ...stats, opId: 'other' }), false);
    expect(fx.state.announcement).toBe('');
    fx.ctl.onDiff(diff(fx.ctl.lastCommitRev!, 'commit', stats), false);
    expect(fx.state.announcement).toBe(strokeMessage(stats));
  });

  it('ignores non-primary buttons and treats a pen like a mouse', () => {
    down(0, 0, { button: 2 });
    expect(fx.ctl.stroking).toBe(false);
    move(30, 0);
    up(30, 0, { button: 2 });
    expect(fx.editor.plan.ops).toHaveLength(0);

    stroke({ type: 'pen', id: 7 });
    expect(fx.editor.plan.ops).toHaveLength(1);
  });

  it('does not paint when read-only or before ready, even if state.tool is paint', () => {
    fx.state.phase = 'loading';
    flushSync();
    expect(lastPan()).toBe(true);
    down(0, 0);
    expect(fx.ctl.stroking).toBe(false);
    up(0, 0);

    fx.state.phase = 'ready';
    fx.editor.load(emptyPlan('fixture-0'), { readOnly: true });
    flushSync();
    expect(fx.state.tool).toBe('paint');
    expect(lastPan()).toBe(true);
    down(0, 0);
    expect(fx.ctl.stroking).toBe(false);
    up(0, 0);
    key('Enter', {}, fx.canvas);
    expect(fx.editor.plan.ops).toHaveLength(0);
  });
});

describe('BrushController pan mode and Space', () => {
  it('disables pan in paint mode and enables it for Move', () => {
    expect(lastPan()).toBe(false);
    expect(fx.box.style.cursor).toBe('crosshair');
    fx.ctl.setTool('move');
    flushSync();
    expect(lastPan()).toBe(true);
    expect(fx.box.style.cursor).toBe('');
  });

  it('claims touch-action in paint mode (no browser pointercancel) and returns it to MapLibre', () => {
    expect(fx.box.style.touchAction).toBe('none');
    key(' ');
    flushSync();
    expect(fx.box.style.touchAction).toBe('');
    keyUp(' ');
    flushSync();
    expect(fx.box.style.touchAction).toBe('none');
    fx.ctl.setTool('move');
    flushSync();
    expect(fx.box.style.touchAction).toBe('');
    fx.ctl.setTool('erase');
    flushSync();
    expect(fx.box.style.touchAction).toBe('none');
    fx.ctl.destroy();
    expect(fx.box.style.touchAction).toBe('');
  });

  it('enters temporary Move on Space and leaves it on keyup', () => {
    const e = key(' ');
    flushSync();
    expect(e.defaultPrevented).toBe(true);
    expect(lastPan()).toBe(true);
    expect(fx.box.style.cursor).toBe('grab');
    down(0, 0);
    expect(fx.ctl.stroking).toBe(false);
    up(0, 0);
    keyUp(' ');
    flushSync();
    expect(lastPan()).toBe(false);
  });

  it('ignores Space during a stroke', () => {
    down(0, 0);
    const n = fx.handle.pan.length;
    const e = key(' ');
    flushSync();
    expect(e.defaultPrevented).toBe(false);
    expect(fx.handle.pan.slice(n)).not.toContain(true);
    move(30, 0);
    expect(fx.ctl.stroking).toBe(true);
    up(30, 0);
    expect(fx.editor.plan.ops).toHaveLength(1);
  });

  it('leaves Space alone on buttons and other controls', () => {
    const btn = document.createElement('button');
    const radio = document.createElement('div');
    radio.setAttribute('role', 'radio');
    document.body.appendChild(btn);
    document.body.appendChild(radio);
    for (const t of [btn, radio]) {
      const e = key(' ', {}, t);
      flushSync();
      expect(e.defaultPrevented).toBe(false);
      expect(fx.state.spaceHeld).toBe(false);
    }
    expect(lastPan()).toBe(false);
    btn.remove();
    radio.remove();
  });

  it('releases Space on window blur', () => {
    key(' ');
    flushSync();
    expect(lastPan()).toBe(true);
    window.dispatchEvent(new Event('blur'));
    flushSync();
    expect(fx.state.spaceHeld).toBe(false);
    expect(lastPan()).toBe(false);
  });

  it('survives keyboard events with an undefined key', () => {
    const errors: unknown[] = [];
    const onErr = (e: ErrorEvent) => errors.push(e.error);
    window.addEventListener('error', onErr);
    const e = new KeyboardEvent('keydown', { bubbles: true });
    Object.defineProperty(e, 'key', { value: undefined });
    document.body.dispatchEvent(e);
    window.removeEventListener('error', onErr);
    expect(errors).toEqual([]);
  });
});

describe('BrushController touch', () => {
  it('cancels on a second touch and needs a fresh touch to paint again', () => {
    const t1 = { type: 'touch', id: 1 };
    down(0, 0, t1);
    move(40, 0, t1);
    fx.flushRaf();
    expect(fx.client.previews).toHaveLength(1);
    down(50, 50, { type: 'touch', id: 2, primary: false });
    expect(fx.ctl.stroking).toBe(false);
    expect(fx.client.cancels).toHaveLength(1);
    expect(fx.editor.plan.ops).toHaveLength(0);

    up(50, 50, { type: 'touch', id: 2, primary: false });
    move(80, 0, t1);
    fx.flushRaf();
    expect(fx.ctl.stroking).toBe(false);
    expect(fx.client.previews).toHaveLength(1);
    up(80, 0, t1);
    expect(fx.editor.plan.ops).toHaveLength(0);

    stroke({ type: 'touch', id: 3 });
    expect(fx.editor.plan.ops).toHaveLength(1);
  });
});

describe('BrushController cancel paths', () => {
  it('cancels on Escape', () => {
    down(0, 0);
    move(30, 0);
    key('Escape');
    up(30, 0);
    expect(fx.ctl.stroking).toBe(false);
    expect(fx.editor.plan.ops).toHaveLength(0);
  });

  it('cancels on window blur and pointercancel', () => {
    down(0, 0);
    move(30, 0);
    fx.flushRaf();
    window.dispatchEvent(new Event('blur'));
    expect(fx.ctl.stroking).toBe(false);
    expect(fx.client.cancels).toHaveLength(1);
    up(30, 0);

    down(0, 0);
    ptr('pointercancel', 0, 0);
    expect(fx.ctl.stroking).toBe(false);
    expect(fx.editor.plan.ops).toHaveLength(0);
  });

  it.each([
    ['e', 'erase'],
    ['v', 'move'],
    ['b', 'paint']
  ] as const)('cancels on %s mid-stroke and switches tool', (k, tool) => {
    if (tool === 'paint') fx.ctl.setTool('erase');
    down(0, 0);
    move(30, 0);
    key(k);
    expect(fx.ctl.stroking).toBe(false);
    expect(fx.state.tool).toBe(tool);
    up(30, 0);
    expect(fx.editor.plan.ops).toHaveLength(0);
  });
});

describe('BrushController keyboard stamp, undo and redo', () => {
  it('stamps at the quantised centre on Enter only when the canvas is focused', () => {
    fx.canvas.focus();
    const e = key('Enter', {}, fx.canvas);
    expect(e.defaultPrevented).toBe(true);
    expect(fx.editor.plan.ops).toHaveLength(1);
    const op = fx.editor.plan.ops[0];
    expect(op.path).toEqual([[quantize(-122.42), quantize(37.76)]]);
    expect(fx.client.commits[0].op).toEqual(op);

    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    key('Enter', {}, btn);
    expect(fx.editor.plan.ops).toHaveLength(1);
    btn.remove();
  });

  it('ignores undo mid-stroke, then undoes and redoes with announcements', () => {
    stroke();
    const id = fx.editor.plan.ops[0].id;
    down(0, 0);
    move(30, 0);
    const z = key('z', { ctrlKey: true });
    expect(z.defaultPrevented).toBe(true);
    expect(fx.client.undos).toEqual([]);
    expect(fx.editor.plan.ops).toHaveLength(1);
    key('Escape');

    key('z', { ctrlKey: true });
    expect(fx.client.undos).toEqual([id]);
    expect(fx.editor.plan.ops).toHaveLength(0);
    expect(fx.state.announcement).toBe('Undid paint, 6 stories');

    const strokeRev = fx.ctl.markedCommitRev;
    expect(strokeRev).toBe(fx.client.commits[0].rev);
    key('z', { ctrlKey: true, shiftKey: true });
    expect(fx.client.commits.at(-1)!.op.id).toBe(id);
    expect(fx.ctl.lastCommitRev).toBe(fx.client.commits.at(-1)!.rev);
    // A redo sets no pointerup mark, so the page must not measure it (it would span from the
    // stroke's pointerup): markedCommitRev stays on the stroke.
    expect(fx.ctl.markedCommitRev).toBe(strokeRev);
    expect(fx.ctl.markedCommitRev).not.toBe(fx.ctl.lastCommitRev);
    expect(fx.editor.plan.ops).toHaveLength(1);
    expect(fx.state.announcement).toBe('Redid paint, 6 stories');
  });

  it('steps stories and radius from the keyboard', () => {
    key('=');
    key('-');
    key('-');
    key(']');
    expect(fx.state.stories).toBe(5);
    expect(fx.state.radiusM).toBe(38);
  });

  it('leaves stories alone for + / = / - on the focused canvas, where MapLibre zooms (F-1)', () => {
    fx.canvas.focus();
    const before = fx.state.stories;
    key('+', { shiftKey: true }, fx.canvas);
    key('=', {}, fx.canvas);
    key('-', {}, fx.canvas);
    expect(fx.state.stories).toBe(before);
    fx.canvas.blur();
  });
});

describe('BrushController overlay, crosshair, prefetch', () => {
  it('shows the hover ring in paint mode and clears to [] for Move', () => {
    move(20, 20);
    flushSync();
    expect(ids(fx.handle.overlays.at(-1))).toContain('brush-ring');
    fx.ctl.setTool('move');
    flushSync();
    expect(fx.handle.overlays.at(-1)).toEqual([]);
  });

  it('draws only the ring during a stroke, never a swath (partner ruling 2026-10-12)', () => {
    for (const tool of ['paint', 'erase'] as const) {
      fx.ctl.setTool(tool);
      const n = fx.handle.overlays.length;
      down(0, 0);
      move(40, 0);
      move(0, 5);
      move(40, 10);
      flushSync();
      expect(ids(fx.handle.overlays.at(-1))).toEqual(['brush-ring']);
      expect(fx.handle.overlays.slice(n).flatMap(ids)).not.toContain('brush-swath');
      up(40, 10);
      flushSync();
    }
  });

  it('does not follow touch hover', () => {
    const n = fx.handle.overlays.length;
    move(20, 20, { type: 'touch' });
    flushSync();
    expect(fx.handle.overlays.slice(n).flatMap(ids)).not.toContain('brush-ring');
  });

  it('labels the canvas and reports the crosshair on focus', () => {
    expect(fx.canvas.getAttribute('aria-label')).toBe(MSG.mapLabel);
    fx.canvas.focus();
    expect(fx.crosshair.at(-1)).toBe(fx.canvas.matches(':focus-visible'));
    fx.canvas.blur();
    expect(fx.crosshair.at(-1)).toBe(false);
  });

  it('prefetches the viewport on moveend at zoom ≥ 14 in paint mode only', () => {
    fx.map.fire('moveend');
    expect(fx.client.prefetches).toEqual([[-122.43, 37.75, -122.41, 37.77]]);
    fx.map.zoom = 13;
    fx.map.fire('moveend');
    fx.map.zoom = 17;
    fx.ctl.setTool('move');
    fx.map.fire('moveend');
    expect(fx.client.prefetches).toHaveLength(1);
  });

  it('removes its listeners on destroy', () => {
    fx.ctl.destroy();
    down(0, 0);
    expect(fx.ctl.stroking).toBe(false);
    fx.map.fire('moveend');
    expect(fx.client.prefetches).toHaveLength(0);
  });
});

describe('BrushController stale touch and in-flight recovery', () => {
  it('a primary touch clears a stale tracked touch whose pointerup never arrived', () => {
    down(0, 0, { type: 'touch', id: 1 }); // its pointerup/cancel is lost
    fx.ctl.cancelStroke();
    stroke({ type: 'touch', id: 2 });
    expect(fx.editor.plan.ops).toHaveLength(1);
  });

  it('a primary touch resets touchBlocked left over from a lost pinch', () => {
    down(0, 0, { type: 'touch', id: 1 });
    down(50, 50, { type: 'touch', id: 2, primary: false }); // pinch: blocked
    expect(fx.ctl.stroking).toBe(false);
    // Neither pointerup arrives. A fresh primary touch paints.
    stroke({ type: 'touch', id: 3 });
    expect(fx.editor.plan.ops).toHaveLength(1);
  });

  it('window blur clears tracked touches', () => {
    down(0, 0, { type: 'touch', id: 1 }); // its pointerup is lost to the blur
    window.dispatchEvent(new Event('blur'));
    down(0, 0); // a mouse stroke
    expect(fx.ctl.stroking).toBe(true);
    // A stale touch id would make this lone touch count as a second finger and cancel the stroke.
    down(50, 50, { type: 'touch', id: 2, primary: false });
    expect(fx.ctl.stroking).toBe(true);
    up(0, 0);
  });

  it('onError clears an in-flight preview whose rev is at or below the error rev', () => {
    down(0, 0);
    move(30, 0);
    fx.flushRaf();
    expect(fx.client.previews).toHaveLength(1);
    const rev = fx.client.previews[0].rev;
    move(60, 0);
    fx.flushRaf();
    expect(fx.client.previews).toHaveLength(1); // blocked behind the in-flight one

    fx.ctl.onError(rev - 1); // an older error does not clear it
    fx.flushRaf();
    expect(fx.client.previews).toHaveLength(1);

    fx.ctl.onError(rev);
    fx.flushRaf();
    expect(fx.client.previews).toHaveLength(2); // the dirty path goes out
    up(60, 0);
  });

  it('a new stroke after a commit does not wait on the previous stroke’s unanswered preview', () => {
    down(0, 0);
    move(30, 0);
    fx.flushRaf();
    expect(fx.client.previews).toHaveLength(1);
    up(30, 0); // commit sent; the preview reply never arrives
    expect(fx.client.commits).toHaveLength(1);

    down(0, 50);
    move(40, 50);
    fx.flushRaf();
    expect(fx.client.previews).toHaveLength(2);
    up(40, 50);
  });

  it('a new stroke after a cancel does not wait on the cancelled preview', () => {
    down(0, 0);
    move(30, 0);
    fx.flushRaf();
    key('Escape');
    expect(fx.client.cancels).toHaveLength(1);
    up(30, 0);

    down(0, 50);
    move(40, 50);
    fx.flushRaf();
    expect(fx.client.previews).toHaveLength(2);
    up(40, 50);
  });
});

describe('BrushController and Editor.load', () => {
  it('previews never change editor.plan; only the pointer-up commit does', () => {
    const before = fx.editor.plan;
    down(0, 0);
    for (let x = 10; x <= 60; x += 10) move(x, 0);
    fx.flushRaf();
    expect(fx.client.previews.length).toBeGreaterThan(0);
    fx.ctl.onDiff(diff(fx.client.previews.at(-1)!.rev, 'preview'), false);
    move(70, 0);
    fx.flushRaf();
    expect(fx.editor.plan).toBe(before);
    expect(fx.editor.plan.ops).toHaveLength(0);
    up(70, 0);
    expect(fx.editor.plan).not.toBe(before);
    expect(fx.editor.plan.ops).toHaveLength(1);
  });

  it('pan mode follows a load that toggles read-only, and a stroke in progress is cancelled', () => {
    expect(lastPan()).toBe(false);
    down(0, 0);
    move(10, 0);
    fx.flushRaf();
    expect(fx.ctl.stroking).toBe(true);
    fx.editor.load(emptyPlan('fixture-0'), { readOnly: true });
    flushSync();
    expect(lastPan()).toBe(true);
    expect(fx.ctl.stroking).toBe(false);
    expect(fx.box.style.touchAction).toBe('');
    fx.editor.load(emptyPlan('fixture-0'), { readOnly: false });
    flushSync();
    expect(lastPan()).toBe(false);
    expect(fx.box.style.touchAction).toBe('none');
  });
});
