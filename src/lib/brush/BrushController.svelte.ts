import { untrack } from 'svelte';
import { SF_BBOX, quantize, type PlanOp } from '$lib/plan';
import type { SimMapHandle } from '$lib/map/types';
import type { SimClient } from '$lib/sim/client';
import type { DiffResponse } from '$lib/sim/protocol';
import type { Editor } from './editor.svelte';
import { newOpId } from './ids';
import { ANNOUNCE_MS, MSG, TOO_LARGE_MS, strokeMessage, undoMessage } from './messages';
import { buildOverlayLayers, metersPerPixel, type OverlayCtors } from './overlay';
import { stepRadius } from './radius';
import { createSampler, type BrushTool, type StrokeSampler } from './sampler';
import { actionForKey } from './shortcuts';
import type { BrushState } from './state.svelte';

export interface ControllerMap {
  // the subset of maplibre Map the controller uses (stubbed in tests)
  getCanvas(): HTMLCanvasElement;
  getCanvasContainer(): HTMLElement;
  unproject(p: [number, number]): { lng: number; lat: number };
  getCenter(): { lng: number; lat: number };
  getZoom(): number;
  getBounds(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };
  on(ev: 'move' | 'moveend' | 'zoom', fn: () => void): void;
  off(ev: 'move' | 'moveend' | 'zoom', fn: () => void): void;
}

export interface BrushControllerDeps {
  handle: Pick<SimMapHandle, 'setPanEnabled' | 'setOverlayLayers'>;
  map: ControllerMap;
  client: Pick<
    SimClient,
    'preview' | 'cancelPreview' | 'commit' | 'undo' | 'prefetch' | 'datasetVersion'
  >;
  editor: Editor;
  state: BrushState;
  layers: OverlayCtors; // from import('@deck.gl/layers')
  raf(cb: () => void): number;
  cancelRaf(h: number): void;
  dark?(): boolean; // default matchMedia('(prefers-color-scheme: dark)')
  win?: Window; // default window (keydown/keyup/blur listeners)
  onCrosshair?(visible: boolean): void;
}

type LngLat = [number, number];

interface Stroke {
  pointerId: number;
  pointerType: string;
  kind: 'paint' | 'erase';
  stories: number;
  radiusM: number;
  id: string;
  sampler: StrokeSampler;
  sentPreview: boolean;
  lastSent: LngLat[] | null;
}

const MEASURE = import.meta.env.DEV || import.meta.env.VITE_E2E === '1';
const PREFETCH_MIN_ZOOM = 14;
const ZOOM_HINT_PX = 4;

/** Space on these keeps its native meaning (activate / toggle), never temporary Move. */
const SPACE_NATIVE = 'button, a[href], summary, [role="radio"], [role="button"]';

function defaultDark(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function samePath(a: LngLat[], b: LngLat[] | null): boolean {
  if (!b || a.length !== b.length) return false;
  return a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
}

const inBBox = (p: LngLat) =>
  p[0] >= SF_BBOX[0] && p[1] >= SF_BBOX[1] && p[0] <= SF_BBOX[2] && p[1] <= SF_BBOX[3];

/**
 * Turns pointer, touch, pen and keyboard input over the map into brush ops (spec §4.1, §4.3–§4.8):
 * rate-limited previews with at most one in flight, commit through the editor, cancel, undo/redo,
 * the keyboard stamp, the ring/swath overlay, pan mode and viewport prefetch.
 */
export class BrushController {
  #d: BrushControllerDeps;
  #win: Window;
  #dark: () => boolean;

  #stroking = $state(false);
  #ring = $state.raw<LngLat | null>(null);
  #swath = $state.raw<LngLat[] | null>(null);
  #zoomTick = $state(0);

  #stroke: Stroke | null = null;
  #touches = new Set<number>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  #touchBlocked = false;
  #rafHandle: number | null = null;
  #inFlightRev: number | null = null;
  #dirty = false;
  #awaitingStats: string | null = null;
  #crosshair = false;
  #lastCommitRev: number | null = null;
  #lastPan: boolean | null = null;
  #overlayEmpty = false;
  #disposeEffects: (() => void) | null = null;

  constructor(deps: BrushControllerDeps) {
    this.#d = deps;
    this.#win = deps.win ?? window;
    this.#dark = deps.dark ?? defaultDark;
  }

  get stroking(): boolean {
    return this.#stroking;
  }

  /** rev of the last commit sent, for the page's performance.mark pairing. */
  get lastCommitRev(): number | null {
    return this.#lastCommitRev;
  }

  attach(): void {
    if (this.#disposeEffects) return;
    const { map } = this.#d;
    const box = map.getCanvasContainer();
    const canvas = map.getCanvas();
    canvas.setAttribute('aria-label', MSG.mapLabel);
    box.addEventListener('pointerdown', this.#onDown, true);
    box.addEventListener('pointermove', this.#onMove, true);
    box.addEventListener('pointerup', this.#onUp, true);
    box.addEventListener('pointercancel', this.#onCancel, true);
    box.addEventListener('pointerleave', this.#onLeave);
    canvas.addEventListener('focus', this.#updateCrosshair);
    canvas.addEventListener('blur', this.#updateCrosshair);
    this.#win.addEventListener('keydown', this.#onKey);
    this.#win.addEventListener('keyup', this.#onKey);
    this.#win.addEventListener('blur', this.#onWinBlur);
    map.on('move', this.#onMapMove);
    map.on('moveend', this.#onMoveEnd);
    map.on('zoom', this.#onZoom);
    this.#disposeEffects = $effect.root(() => {
      $effect(() => this.#syncPanMode());
      $effect(() => this.#syncOverlay());
    });
  }

  destroy(): void {
    if (!this.#disposeEffects) return;
    const { map } = this.#d;
    const box = map.getCanvasContainer();
    const canvas = map.getCanvas();
    box.removeEventListener('pointerdown', this.#onDown, true);
    box.removeEventListener('pointermove', this.#onMove, true);
    box.removeEventListener('pointerup', this.#onUp, true);
    box.removeEventListener('pointercancel', this.#onCancel, true);
    box.removeEventListener('pointerleave', this.#onLeave);
    canvas.removeEventListener('focus', this.#updateCrosshair);
    canvas.removeEventListener('blur', this.#updateCrosshair);
    this.#win.removeEventListener('keydown', this.#onKey);
    this.#win.removeEventListener('keyup', this.#onKey);
    this.#win.removeEventListener('blur', this.#onWinBlur);
    map.off('move', this.#onMapMove);
    map.off('moveend', this.#onMoveEnd);
    map.off('zoom', this.#onZoom);
    this.#disposeEffects();
    this.#disposeEffects = null;
    this.#endStroke(); // the client may already be disposed: send nothing
    box.style.cursor = '';
  }

  setTool(t: BrushTool): void {
    if (this.#stroke) this.cancelStroke();
    this.#d.state.tool = t;
    this.#updateCrosshair();
  }

  onDiff(d: DiffResponse, stale: boolean): void {
    if (this.#inFlightRev !== null && d.rev >= this.#inFlightRev) {
      this.#inFlightRev = null;
      if (this.#dirty && this.#stroke) {
        this.#dirty = false;
        this.#schedulePreview();
      }
    }
    if (!stale && d.phase === 'commit' && d.stats && d.stats.opId === this.#awaitingStats) {
      this.#awaitingStats = null;
      this.#d.state.announce(strokeMessage(d.stats), ANNOUNCE_MS);
    }
  }

  cancelStroke(): void {
    const s = this.#stroke;
    if (!s) return;
    if (s.sentPreview) this.#d.client.cancelPreview();
    this.#endStroke();
  }

  stampAtCenter(): void {
    if (!this.#canPaint() || this.#stroke) return;
    const { state, map } = this.#d;
    const c = map.getCenter();
    const q: LngLat = [quantize(c.lng), quantize(c.lat)];
    if (!inBBox(q)) return;
    const op: PlanOp =
      state.tool === 'paint'
        ? {
            kind: 'paint',
            stories: state.stories,
            radiusM: state.radiusM,
            path: [q],
            id: newOpId()
          }
        : { kind: 'erase', radiusM: state.radiusM, path: [q], id: newOpId() };
    this.#commitOp(op, false);
  }

  undo(): void {
    const { editor, client, state } = this.#d;
    if (this.#stroke || editor.readOnly) return;
    const op = editor.undo();
    if (!op) return;
    if (this.#awaitingStats === op.id) this.#awaitingStats = null;
    client.undo(op.id);
    state.announce(undoMessage(op, 'Undid'), ANNOUNCE_MS);
  }

  redo(): void {
    const { editor, client, state } = this.#d;
    if (this.#stroke || editor.readOnly) return;
    const op = editor.redo();
    if (!op) return;
    this.#lastCommitRev = client.commit(op);
    state.announce(undoMessage(op, 'Redid'), ANNOUNCE_MS);
  }

  // ---- gating, effects ----

  /** Ruling (a): the effective tool, not state.tool alone (the toolbar shows Move otherwise). */
  #canPaint(): boolean {
    const { state, editor } = this.#d;
    return state.phase === 'ready' && !editor.readOnly && state.tool !== 'move';
  }

  #syncPanMode(): void {
    const { state, handle, map } = this.#d;
    const canPaint = this.#canPaint();
    const pan = !canPaint || state.spaceHeld;
    if (pan !== this.#lastPan) {
      this.#lastPan = pan;
      handle.setPanEnabled(pan); // R13: never touch map.dragPan directly
    }
    map.getCanvasContainer().style.cursor = state.spaceHeld ? 'grab' : canPaint ? 'crosshair' : '';
    untrack(() => {
      if (!canPaint && this.#stroke) this.cancelStroke(); // read-only/phase change mid-stroke
      this.#updateCrosshair();
    });
  }

  #syncOverlay(): void {
    const { state, map, handle } = this.#d;
    const canPaint = this.#canPaint();
    const ring = this.#ring;
    const swath = this.#swath;
    const stroking = this.#stroking;
    const radiusM = stroking && this.#stroke ? this.#stroke.radiusM : state.radiusM;
    const tool = state.tool;
    void this.#zoomTick;
    untrack(() => {
      const lat = ring ? ring[1] : map.getCenter().lat;
      const mpp = metersPerPixel(lat, map.getZoom());
      state.zoomHint = canPaint && radiusM / mpp < ZOOM_HINT_PX;
      if (!canPaint || tool === 'move' || (!ring && !swath)) {
        if (!this.#overlayEmpty) handle.setOverlayLayers([]);
        this.#overlayEmpty = true;
        return;
      }
      const layers = buildOverlayLayers(this.#d.layers, {
        tool,
        ring,
        radiusM,
        swath,
        metersPerPixel: mpp,
        dark: this.#dark()
      });
      handle.setOverlayLayers(layers);
      this.#overlayEmpty = layers.length === 0;
    });
  }

  #centre(): LngLat {
    const c = this.#d.map.getCenter();
    return [c.lng, c.lat];
  }

  #updateCrosshair = (): void => {
    const canvas = this.#d.map.getCanvas();
    let focusVisible: boolean;
    try {
      focusVisible = canvas.matches(':focus-visible');
    } catch {
      focusVisible = document.activeElement === canvas;
    }
    const visible = focusVisible && this.#canPaint();
    const was = this.#crosshair;
    this.#crosshair = visible;
    this.#d.onCrosshair?.(visible);
    if (visible) this.#ring = this.#centre();
    else if (was && !this.#stroke) this.#ring = null;
  };

  // ---- strokes ----

  #lngLat(e: PointerEvent): LngLat {
    const { map } = this.#d;
    const rect = map.getCanvasContainer().getBoundingClientRect();
    const p = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    return [p.lng, p.lat];
  }

  #beginStroke(
    base: Pick<Stroke, 'pointerId' | 'pointerType' | 'kind' | 'stories' | 'radiusM'>,
    first: LngLat
  ): void {
    this.#stroke = {
      pointerId: base.pointerId,
      pointerType: base.pointerType,
      kind: base.kind,
      stories: base.stories,
      radiusM: base.radiusM,
      id: newOpId(),
      sampler: createSampler(base.radiusM),
      sentPreview: false,
      lastSent: null
    };
    this.#stroking = true;
    this.#dirty = false;
    this.#push(this.#stroke, first);
  }

  #push(s: Stroke, p: LngLat): void {
    this.#ring = p;
    if (s.sampler.push(p[0], p[1])) this.#swath = s.sampler.path();
  }

  #buildOp(s: Stroke, path: LngLat[]): PlanOp {
    return s.kind === 'paint'
      ? { kind: 'paint', stories: s.stories, radiusM: s.radiusM, path, id: s.id }
      : { kind: 'erase', radiusM: s.radiusM, path, id: s.id };
  }

  /** editor.commit → client.commit, or the refusal handling (spec §4.5). True iff committed. */
  #commitOp(op: PlanOp, previewSent: boolean): boolean {
    const { editor, client, state } = this.#d;
    const r = editor.commit(op, { datasetVersion: client.datasetVersion ?? undefined });
    if (r.ok) {
      if (MEASURE) {
        try {
          performance.mark('sfh-brush-pointerup');
        } catch {
          // measurement is best-effort
        }
      }
      this.#lastCommitRev = client.commit(op);
      this.#awaitingStats = op.id;
      return true;
    }
    if (r.reason === 'too-large' || r.reason === 'too-many-ops') {
      client.cancelPreview();
      state.announce(MSG.tooLarge, TOO_LARGE_MS);
    } else if (previewSent) {
      client.cancelPreview();
    }
    return false;
  }

  #finishStroke(): void {
    const s = this.#stroke;
    if (!s) return;
    const path = s.sampler.path();
    if (path.length === 0) {
      if (s.sentPreview) this.#d.client.cancelPreview();
    } else {
      this.#commitOp(this.#buildOp(s, path), s.sentPreview);
    }
    this.#endStroke();
  }

  /** PATH_MAX_POINTS reached: commit this piece and continue from its last point (spec §4.4). */
  #split(s: Stroke): void {
    const path = s.sampler.path();
    const last = path[path.length - 1];
    if (!this.#commitOp(this.#buildOp(s, path), s.sentPreview)) {
      this.#endStroke();
      return;
    }
    this.#beginStroke(s, last);
  }

  #endStroke(): void {
    const s = this.#stroke;
    if (!s) return;
    try {
      const box = this.#d.map.getCanvasContainer();
      if (box.hasPointerCapture(s.pointerId)) box.releasePointerCapture(s.pointerId);
    } catch {
      // the pointer may already be gone
    }
    if (this.#rafHandle !== null) this.#d.cancelRaf(this.#rafHandle);
    this.#rafHandle = null;
    this.#stroke = null;
    this.#stroking = false;
    this.#dirty = false;
    this.#swath = null;
    if (s.pointerType === 'touch') this.#ring = this.#crosshair ? this.#centre() : null;
  }

  #schedulePreview(): void {
    if (this.#rafHandle !== null) return;
    this.#rafHandle = this.#d.raf(() => {
      this.#rafHandle = null;
      this.#sendPreview();
    });
  }

  #sendPreview(): void {
    const s = this.#stroke;
    if (!s) return;
    if (this.#inFlightRev !== null) {
      this.#dirty = true;
      return;
    }
    const path = s.sampler.path();
    if (path.length === 0 || samePath(path, s.lastSent)) return;
    this.#inFlightRev = this.#d.client.preview(this.#buildOp(s, path));
    s.lastSent = path;
    s.sentPreview = true;
  }

  // ---- DOM handlers ----

  #onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      const another = this.#touches.size > 0;
      this.#touches.add(e.pointerId);
      if (another) {
        if (this.#stroke) this.cancelStroke();
        this.#touchBlocked = true; // MapLibre handles the pinch
        return;
      }
    }
    const { state } = this.#d;
    if (
      !this.#canPaint() ||
      state.spaceHeld ||
      !e.isPrimary ||
      e.button !== 0 ||
      this.#touchBlocked ||
      this.#stroke
    ) {
      return;
    }
    this.#beginStroke(
      {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        kind: state.tool === 'erase' ? 'erase' : 'paint',
        stories: state.stories,
        radiusM: state.radiusM
      },
      this.#lngLat(e)
    );
    try {
      this.#d.map.getCanvasContainer().setPointerCapture(e.pointerId);
    } catch {
      // synthetic or already-released pointers cannot be captured
    }
    this.#schedulePreview();
    e.preventDefault();
  };

  #onMove = (e: PointerEvent): void => {
    const s = this.#stroke;
    if (s && e.pointerId === s.pointerId) {
      const coalesced = e.getCoalescedEvents?.();
      const events = coalesced && coalesced.length > 0 ? coalesced : [e];
      for (const ev of events) {
        const cur = this.#stroke;
        if (!cur) return;
        this.#push(cur, this.#lngLat(ev));
        if (cur.sampler.full()) this.#split(cur);
      }
      this.#schedulePreview();
      return;
    }
    if (!s && e.pointerType !== 'touch' && this.#canPaint()) this.#ring = this.#lngLat(e);
  };

  #releaseTouch(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    this.#touches.delete(e.pointerId);
    if (this.#touches.size === 0) this.#touchBlocked = false;
  }

  #onUp = (e: PointerEvent): void => {
    if (this.#stroke && e.pointerId === this.#stroke.pointerId) this.#finishStroke();
    this.#releaseTouch(e);
  };

  #onCancel = (e: PointerEvent): void => {
    if (this.#stroke && e.pointerId === this.#stroke.pointerId) this.cancelStroke();
    this.#releaseTouch(e);
  };

  #onLeave = (): void => {
    if (!this.#stroke) this.#ring = this.#crosshair ? this.#centre() : null;
  };

  #onWinBlur = (): void => {
    this.cancelStroke();
    this.#d.state.spaceHeld = false; // ruling (c): the keyup may never arrive
  };

  #onKey = (e: KeyboardEvent): void => {
    if (typeof e.key !== 'string') return; // ruling (d): Chrome autofill sends key-less events
    const { state, map } = this.#d;
    const down = e.type === 'keydown';
    if (e.key === ' ') {
      if (!down) {
        state.spaceHeld = false; // always release, wherever focus went
        return;
      }
      if (e.repeat && state.spaceHeld) {
        e.preventDefault(); // keep the page from scrolling while held
        return;
      }
      if (e.target instanceof Element && e.target.closest(SPACE_NATIVE)) return; // ruling (b)
    }
    const a = actionForKey(
      {
        key: e.key,
        code: e.code,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        repeat: e.repeat,
        target: e.target,
        type: down ? 'keydown' : 'keyup'
      },
      { mapFocused: document.activeElement === map.getCanvas() }
    );
    if (!a) return;
    switch (a.type) {
      case 'tool':
        this.setTool(a.tool);
        return;
      case 'stories':
        state.setStories(state.stories + a.delta);
        return;
      case 'radius':
        state.setRadius(stepRadius(state.radiusM, a.dir));
        return;
      case 'undo':
        e.preventDefault();
        this.undo();
        return;
      case 'redo':
        e.preventDefault();
        this.redo();
        return;
      case 'cancel':
        this.cancelStroke();
        return;
      case 'stamp':
        e.preventDefault();
        this.stampAtCenter();
        return;
      case 'space':
        if (!a.down || this.#stroke) return;
        state.spaceHeld = true;
        e.preventDefault();
        return;
    }
  };

  #onMapMove = (): void => {
    if (this.#crosshair && !this.#stroke) this.#ring = this.#centre();
  };

  #onZoom = (): void => {
    this.#zoomTick++;
  };

  #onMoveEnd = (): void => {
    const { map, client } = this.#d;
    if (!this.#canPaint() || map.getZoom() < PREFETCH_MIN_ZOOM) return;
    const b = map.getBounds();
    client.prefetch([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  };
}
