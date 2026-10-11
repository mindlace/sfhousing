import { MSG } from './messages';
import { clampRadius, clampStories } from './radius';
import type { BrushTool } from './sampler';
import { readSettings, writeSettings } from './settings';

export type CityPhase = 'loading' | 'ready' | 'failed';

export interface BrushStateOptions {
  /** Defaults to `matchMedia('(pointer: fine)')` at construction. */
  fine?: boolean;
  /** Defaults to localStorage; null disables persistence. */
  storage?: Storage | null;
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

function pointerFine(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
  } catch {
    return false;
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Reactive brush UI state shared by the toolbar and the controller (spec §4.1, §4.2, §4.5). */
export class BrushState {
  tool = $state<BrushTool>('move');
  stories = $state(6);
  radiusM = $state(30);
  phase = $state<CityPhase>('loading');
  loadingParcels = $state(false);
  zoomHint = $state(false);
  spaceHeld = $state(false);

  #announcement = $state('');
  #timer: ReturnType<typeof setTimeout> | null = null;
  #storage: Storage | null;
  #setTimeout: typeof setTimeout;
  #clearTimeout: typeof clearTimeout;

  /** Ruling R14: city phase > transient announcement > loading parcels > zoom hint. */
  readonly statusText: string = $derived.by(() => {
    if (this.phase === 'loading') return MSG.loadingCity;
    if (this.phase === 'failed') return MSG.cityFailed;
    if (this.#announcement) return this.#announcement;
    if (this.loadingParcels) return MSG.loadingParcels;
    if (this.zoomHint) return MSG.zoomIn;
    return '';
  });

  constructor(opts: BrushStateOptions = {}) {
    this.#storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.#setTimeout = opts.setTimeout ?? globalThis.setTimeout.bind(globalThis);
    this.#clearTimeout = opts.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
    this.tool = (opts.fine ?? pointerFine()) ? 'paint' : 'move';
    const s = readSettings(this.#storage);
    this.stories = s.stories;
    this.radiusM = s.radiusM;
  }

  get announcement(): string {
    return this.#announcement;
  }

  setStories(n: number): void {
    this.stories = clampStories(n);
    this.#persist();
  }

  setRadius(n: number): void {
    this.radiusM = clampRadius(n);
    this.#persist();
  }

  /** Shows `text` for `ms`, replacing any current announcement. */
  announce(text: string, ms: number): void {
    if (this.#timer !== null) this.#clearTimeout(this.#timer);
    this.#announcement = text;
    this.#timer = this.#setTimeout(() => {
      this.#timer = null;
      this.#announcement = '';
    }, ms);
  }

  /** Cancels a pending announcement timer (call on teardown). */
  destroy(): void {
    if (this.#timer !== null) this.#clearTimeout(this.#timer);
    this.#timer = null;
  }

  #persist(): void {
    writeSettings({ stories: this.stories, radiusM: this.radiusM }, this.#storage);
  }
}
