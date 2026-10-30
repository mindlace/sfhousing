<!--
  The timelapse composition (spec §4.1, §4.2, §4.3, §4.7, §4.8): SimMap, the time scrubber, the
  header score bar (ScoreBar, pinned in the header, opening FzpScorePanel), the project card and
  tooltip and the sources dialog, over timelapse-sim's ScenarioClient. Queueing before the map
  handle, chunk statuses and crash Retry mirror BrushEditor.svelte (copied, not imported). /sim
  passes `levers` (plan 3): the session runs the lever engine, and the worker's posted lookups
  replace the calibration's once current.
-->
<script module lang="ts">
  import { chanceTable, typicalMonths } from '$lib/timelapse/model';
  import type { Calibration } from '$lib/timelapse/types';
  import type { SimMapHandle } from '$lib/map/types';
  import type { BrushCatalog, BrushQuery } from '$lib/sim/levers/brushes';
  import type { BrushLotsResult } from '$lib/sim/scenario/types';
  import type { ChanceTable } from './card';

  type Lookups = { chance: ChanceTable; typicalMonths: ReturnType<typeof typicalMonths> };
  type MapLike = NonNullable<ReturnType<SimMapHandle['getMap']>>;

  /** What /sim's page needs from the scenario client (brush pickers and their Retry). */
  export interface SimClientApi {
    resolveBrush(q: BrushQuery): Promise<BrushLotsResult>;
    brushCatalog(): Promise<BrushCatalog | null>;
    retryChunks(): void;
  }

  /**
   * One lookups object per calibration object: SimMap compares lookups by identity, and nothing
   * may mutate them. A reloaded calibration is a new object, so it gets fresh lookups.
   */
  const lookupCache = new WeakMap<Calibration, Lookups>();
  function lookupsFor(cal: Calibration): Lookups {
    let l = lookupCache.get(cal);
    if (!l) {
      l = { chance: chanceTable(cal), typicalMonths: typicalMonths(cal) };
      lookupCache.set(cal, l);
    }
    return l;
  }
</script>

<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte';
  import type { Manifest } from '$lib/data/manifest';
  import SimMap from '$lib/map/SimMap.svelte';
  import type { ChunkStatus, TimelinePick, TimelineUpdate } from '$lib/map/types';
  import { formatCount } from '$lib/scoreboard/format';
  import { useHeaderActions } from '$lib/shell/header-actions.svelte';
  import {
    leversError,
    leversMessage,
    leversSent,
    leversSession,
    type LeverStatus,
    type LeverStatusState
  } from '$lib/sim-page/lever-status';
  import { spawnSimWorker } from '$lib/sim/client';
  import type { LeverLookups } from '$lib/sim/levers/apply';
  import type { SimLevers } from '$lib/sim/levers/types';
  import { scoreCopy } from '$lib/sim-page/policy';
  import type { TimelineScore } from '$lib/sim/protocol';
  import {
    ScenarioClient,
    type ScenarioClientEvents,
    type ScenarioWorkerInput
  } from '$lib/sim/scenario-client';
  import type { Day } from '$lib/timelapse/time';
  import { installFzpDebug } from './debug';
  import ScoreBar from '$lib/sim-page/ScoreBar.svelte';
  import FzpScorePanel from './FzpScorePanel.svelte';
  import { DEFAULT_SPEED } from './playback';
  import ProjectCardPanel from './ProjectCardPanel.svelte';
  import ProjectTooltip from './ProjectTooltip.svelte';
  import { scoreAt, scrubMarkers } from './score-view';
  import SourcesDialog from './SourcesDialog.svelte';
  import { SummaryRequester, type SummaryState } from './summary-request';
  import { HORIZON, monthIndex, monthStart } from './time';
  import TimeScrubber from './TimeScrubber.svelte';
  import type { FzpPhase, Speed } from './types';

  interface Props {
    manifest: Manifest | null;
    manifestError: boolean;
    calibration: Calibration | null;
    calibrationError: boolean;
    noScenario: boolean;
    datasetVersion: string;
    /** `?seed=N`, or null for the representative future. */
    urlSeed: number | null;
    /** Retry step 3: reloads the manifest and calibration; rejects on any failure. */
    reload(): Promise<{ manifest: Manifest; calibration: Calibration }>;
    /** Only on answers to 'Another future' / 'Back to the representative future'. */
    onurlseed?: (seed: number | null) => void;
    /** Tests inject a fake worker. */
    createWorker?: () => ScenarioWorkerInput;
    /**
     * /sim only (absent = /fzp, unchanged): sent with every `initScenario`; a new object once the
     * scenario is live sends `setLevers`.
     */
    levers?: SimLevers;
    /** Every lever status change (/sim). */
    onlevers?: (s: LeverStatus) => void;
    /**
     * The client's brush requests on each new session (`initScenario`: mount, Retry), null on a
     * crash and on unmount. A call with the api means requests answered `no-session` before it
     * can be asked again.
     */
    onclient?: (api: SimClientApi | null) => void;
    /** SimMap's handle and map, once ready. */
    onmapready?: (h: SimMapHandle, map: MapLike) => void;
    /** Rendered inside `.sfh-fzp` (the /sim policy panel). */
    panel?: Snippet;
    /** The page's own header actions, before 'Another future' (/sim: "Policy"). */
    actions?: Snippet;
  }

  let {
    manifest: initialManifest,
    manifestError,
    calibration: initialCalibration,
    calibrationError,
    noScenario,
    datasetVersion,
    urlSeed,
    reload,
    onurlseed = undefined,
    createWorker = spawnSimWorker,
    levers = undefined,
    onlevers = undefined,
    onclient = undefined,
    onmapready = undefined,
    panel = undefined,
    actions = undefined
  }: Props = $props();

  // The props seed the page once; Retry replaces the manifest and calibration in place.
  let manifest = $state.raw<Manifest | null>(untrack(() => initialManifest));
  let calibration = $state.raw<Calibration | null>(untrack(() => initialCalibration));
  /** The main-thread data is missing or the worker rejected the manifest: Retry reloads it. */
  /** The worker rejected the mounted manifest: Retry must send the reloaded object. */
  let manifestRejected = false;
  let needReload = untrack(
    () => manifestError || calibrationError || !initialManifest || !initialCalibration
  );
  let phase = $state<FzpPhase>(
    untrack(() => (noScenario ? 'no-scenario' : needReload ? 'failed' : 'loading'))
  );
  /** The worker said the scenario files are missing or damaged (the dataset copy). */
  let dataError = $state(false);

  let score = $state.raw<TimelineScore | null>(null);
  let seed = $state<number | null>(null);
  let bandRuns = $state(0);
  let bandRunsTotal = $state(0);
  let representative = $state(false);
  let day = $state<Day>(untrack(() => initialCalibration?.asOf ?? 0));
  let playing = $state(false);
  let speed = $state<Speed>(DEFAULT_SPEED);
  /** The worker crashed after ready: scrubbing still works; the chip offers Retry. */
  let stopped = $state(false);
  let rerollBusy = $state(false);
  let rerollFailed = $state(false);
  let scrubberH = $state(0);
  /** The notices above the scrubber (0 when none shows). */
  let noticeH = $state(0);

  /** The lever revision's status (`off` on /fzp). */
  let leverState = $state.raw<LeverStatusState>({
    sentRev: null,
    sessionRev: null,
    status: { kind: 'off' }
  });
  /** The latest current revision's posted lookups; null before the first (and on /fzp). */
  let leverLookups = $state.raw<LeverLookups | null>(null);
  /** The rev of the latest non-stale timeline (0 before any). */
  let timelineRev = $state(0);

  let cardState = $state.raw<SummaryState>({ kind: 'idle' });
  let tipState = $state.raw<SummaryState>({ kind: 'idle' });
  let tipAt = $state({ x: 0, y: 0 });
  let dialog = $state<ReturnType<typeof SourcesDialog>>();

  const asOf = $derived(calibration?.asOf ?? 0);
  const lookups = $derived(calibration ? lookupsFor(calibration) : null);
  /** The card's chance tables: the posted ones once current, else the calibration's. */
  const cardChance = $derived(
    leverLookups
      ? { inFlight: leverLookups.inFlight.chance, fresh: leverLookups.fresh.chance }
      : lookups && { inFlight: lookups.chance, fresh: lookups.chance }
  );
  const leverStatus = $derived(leverState.status);
  /** Who the plan effect is for: the Family Zoning Plan on /fzp and under its levers. */
  const copy = $derived(scoreCopy(levers ?? null));
  const capacity = $derived(leverStatus.kind === 'current' ? leverStatus.capacity : null);
  /**
   * The score on show is from before the latest levers until a timeline at or after their rev
   * arrives (a later reroll's runs on them too); a failed revision leaves the old score standing.
   */
  const scoreBusy = $derived(
    leverState.sentRev !== null && timelineRev < leverState.sentRev && leverStatus.kind !== 'failed'
  );
  const markers = $derived(score ? scrubMarkers(score) : []);
  /** The score at the scrubbed month, for the details panel. */
  const at = $derived(
    score ? scoreAt(score, monthIndex(day, score.months[0], score.months.length)) : null
  );
  const hasScoreboard = $derived(
    calibration !== null && (phase === 'loading' || phase === 'ready')
  );
  const canReroll = $derived(phase === 'ready' && !stopped && !rerollBusy);

  let client: ScenarioClient | null = null;
  /** `client`'s brush requests for `onclient`, one object per client. */
  let clientApi: SimClientApi | null = null;
  let handle: SimMapHandle | null = null;
  let map: MapLike | null = null;
  let dead = false;
  let retrying = false;
  // Until SimMap's handle exists, timeline updates and chunk statuses wait here, in order.
  let pendingUpdates: TimelineUpdate[] = [];
  const pendingStatus = new Map<string, ChunkStatus>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  /** Every cell this worker has given map-view a status for, so a restart can clear them. */
  const statusCells = new Set<string>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  /** The lookups SimMap holds. */
  let pushedLookups: Lookups | null = null;
  /** The levers object the worker last received (identity), with initScenario or setLevers. */
  let sentLevers: SimLevers | null = null;
  /** A non-stale timeline has arrived since the last initScenario. */
  let scenarioLive = false;
  /** Prefetch the viewport on the first timeline after each initScenario. */
  let prefetchDue = false;
  let asOfChecked = false;
  /** The scrubbed month the open card was last requested for. */
  let cardMonth: Day | null = null;
  /** FzpMode's root, for the dock's top edge (`--fzp-dock-top`). */
  let rootEl = $state<HTMLDivElement>();

  /**
   * The page's latest scenario request. `representative` is the flag its answer sets (null =
   * keep); `writesUrl` asks for `onurlseed` on the answer. A higher rev is the client's resync,
   * which changes nothing here.
   */
  let latest: {
    rev: number;
    representative: boolean | null;
    writesUrl: boolean;
    answered: boolean;
  } | null = null;

  function setLeverState(next: LeverStatusState): void {
    if (next === leverState) return;
    const changed = next.status !== leverState.status;
    leverState = next;
    if (changed) onlevers?.(next.status);
  }

  /**
   * The T9 seam (spec §5): every `initScenario` goes through here, with the current `levers` on
   * /sim. A request for the future already shown (crash Retry) keeps the representative flag; a
   * null seed is the representative future.
   */
  function startScenario({ seed: next }: { seed: number | null }): void {
    if (!client || !manifest) return;
    const l = untrack(() => levers);
    const rev = client.initScenario(manifest, HORIZON, next, l);
    if (l !== undefined) {
      sentLevers = l;
      setLeverState(leversSession(leverState, rev));
    }
    if (clientApi) onclient?.(clientApi);
    const keep = next !== null && next === seed;
    latest = {
      rev,
      representative: keep ? null : next === null,
      writesUrl: false,
      answered: false
    };
    scenarioLive = false;
    prefetchDue = true;
  }

  /**
   * Sends a new `levers` object once the scenario is live. It waits while a reroll is in flight,
   * so the reroll's answer (and its URL write) is not superseded; the answer calls this again.
   */
  function syncLevers(): void {
    const l = untrack(() => levers);
    if (l === undefined || l === sentLevers || dead || !client || client.crashed) return;
    if (!scenarioLive || rerollBusy) return;
    sentLevers = l;
    setLeverState(leversSent(leverState, client.setLevers(l)));
  }

  $effect(() => {
    void levers;
    untrack(syncLevers);
  });

  function requestReroll(next: number | null): void {
    if (!client || !canReroll) return;
    const rev = client.reroll(next);
    latest = { rev, representative: next === null, writesUrl: true, answered: false };
    rerollBusy = true;
    rerollFailed = false;
  }

  function anotherFuture(): void {
    requestReroll(crypto.getRandomValues(new Uint32Array(1))[0]);
  }

  function pushLookups(): void {
    if (!handle || !calibration) return;
    // T9 lookups seam (spec §5): the page builds chanceTable and typicalMonths from the base
    // calibration.json until a lever revision is current; then the worker's posted lookups
    // replace them (/sim). The map takes one set, the new projects' (Call 13); the card picks
    // its cohort's from `cardChance`.
    const l = leverLookups?.fresh ?? lookupsFor(calibration);
    if (l === pushedLookups) return;
    pushedLookups = l;
    handle.setTimelineLookups(l);
  }

  function applyRender(u: TimelineUpdate): void {
    if (handle) return handle.applyTimeline(u);
    if (u.revision === 0) pendingUpdates = []; // a full snapshot supersedes what came before
    pendingUpdates.push(u);
  }

  function setChunkStatus(cellId: string, s: ChunkStatus): void {
    statusCells.add(cellId);
    if (handle) return handle.setChunkStatus(cellId, s);
    pendingStatus.delete(cellId);
    pendingStatus.set(cellId, s);
  }

  /** As BrushEditor.svelte:249-253: the restarted worker reports only the cells it fetches. */
  function resetChunkStatuses(): void {
    for (const cellId of statusCells) setChunkStatus(cellId, 'ready');
    statusCells.clear();
  }

  function checkAsOf(s: TimelineScore): void {
    if (asOfChecked || !calibration) return;
    asOfChecked = true;
    if (monthStart(calibration.asOf) !== s.months[0]) {
      console.error(
        '[fzp] data error: calibration asOf is not in the month of score.months[0]',
        calibration.asOf,
        s.months[0]
      );
    }
  }

  function prefetchViewport(): void {
    if (!client || client.crashed || !map || !scenarioLive) return;
    const b = map.getBounds();
    client.prefetch([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  }

  function onMoveEnd(): void {
    prefetchViewport();
  }

  /** Follows SimMap's current map (a new manifest remounts it). */
  function attachMap(m: MapLike | null): void {
    if (m === map) return;
    map?.off('moveend', onMoveEnd);
    map = m;
    map?.on('moveend', onMoveEnd);
  }

  function flushPrefetch(): void {
    if (!prefetchDue || !scenarioLive || !map) return;
    prefetchDue = false;
    prefetchViewport();
  }

  const summaryDeps = {
    send: (q: { parcelId: string; day: Day; projectId?: string }) =>
      client ? client.parcelSummary(q.parcelId, q.day, q.projectId) : Promise.resolve(null),
    unavailable: () => client?.crashed ?? false
  };
  const cardReq = new SummaryRequester({ ...summaryDeps, onstate: (s) => (cardState = s) });
  const tipReq = new SummaryRequester({ ...summaryDeps, onstate: (s) => (tipState = s) });

  /** The open card asks again for the scrubbed day (month change, reroll, Retry, crash). */
  function refreshCard(): void {
    const q = cardReq.query;
    if (!q || cardState.kind === 'idle') return;
    cardMonth = monthStart(day);
    cardReq.request({ ...q, day });
  }

  function closeCard(): void {
    cardReq.reset();
    cardMonth = null;
  }

  function hideTooltip(): void {
    tipReq.reset();
  }

  function onPick(p: TimelinePick): void {
    if (p.projectId === null) {
      hideTooltip();
      if (p.kind === 'tap') closeCard();
      return;
    }
    const q = { parcelId: p.parcelId, day, projectId: p.projectId };
    if (p.kind === 'hover') {
      tipAt = { x: p.x, y: p.y };
      tipReq.request(q);
      return;
    }
    hideTooltip();
    cardMonth = monthStart(day);
    cardReq.request(q);
  }

  /** The scrubber's day changed (once per change): O(1) work. */
  function onDay(d: Day): void {
    handle?.setTime(d);
    if (cardMonth !== null && monthStart(d) !== cardMonth) refreshCard();
  }

  function applyInset(): void {
    handle?.setBottomInset(scrubberH + noticeH);
  }

  /**
   * The viewport y of the dock's top edge (the notices and the scrubber), on :root as
   * `--fzp-dock-top`: the header's score details end above it. Set while FzpMode is mounted.
   */
  function publishDockTop(): void {
    if (!rootEl) return;
    const top = rootEl.getBoundingClientRect().bottom - (scrubberH + noticeH);
    document.documentElement.style.setProperty('--fzp-dock-top', `${Math.floor(top)}px`);
  }
  $effect(() => {
    void scrubberH;
    void noticeH;
    void rootEl;
    untrack(publishDockTop);
  });

  // A notice appearing or going changes the dock's height.
  $effect(() => {
    void noticeH;
    untrack(applyInset);
  });

  const events: ScenarioClientEvents = {
    onTimeline(t) {
      if (dead || !client || client.isStale(t)) return;
      timelineRev = t.rev;
      applyRender(t.render);
      score = t.score;
      seed = t.seed;
      bandRuns = t.bandRuns;
      bandRunsTotal = t.bandRunsTotal;
      checkAsOf(t.score);
      const req = latest;
      const answer = req !== null && !req.answered && t.rev === req.rev;
      if (answer) {
        req.answered = true;
        if (req.representative !== null) representative = req.representative;
        if (req.writesUrl) onurlseed?.(req.representative ? null : t.seed);
        rerollBusy = false;
        rerollFailed = false;
        stopped = false;
      } else if (req !== null && !req.answered && t.rev > req.rev) {
        // The client's resync superseded the page's request (its answer will be stale): the
        // shown future is the resync's, the seed it already showed, so the URL and the flag stay.
        req.answered = true;
        rerollBusy = false;
      }
      if (phase === 'loading') phase = 'ready';
      else if (answer) refreshCard();
      scenarioLive = true;
      if (handle) attachMap(handle.getMap());
      flushPrefetch();
      syncLevers();
    },
    onLevers(m) {
      if (dead) return;
      const next = leversMessage(leverState, m);
      if (next === leverState) return; // below the latest levers sent
      setLeverState(next);
      if (m.phase === 'current') {
        leverLookups = m.lookups;
        pushLookups();
      }
    },
    onChunks(c) {
      if (dead) return;
      for (const [cellId, s] of Object.entries(c.status)) setChunkStatus(cellId, s);
      cardReq.retryIfNotLoaded(day);
      tipReq.retryIfNotLoaded(day);
    },
    onError(e) {
      if (dead) return;
      setLeverState(leversError(leverState, e.rev, e.code));
      const req = latest;
      if (req !== null && e.rev < req.rev) {
        console.debug('[fzp] stale worker error dropped', e.code, e.rev);
        return;
      }
      if (req === null || req.answered || e.rev !== req.rev) {
        console.error('[fzp] worker error', e.code, e.message);
        return;
      }
      req.answered = true;
      console.error('[fzp] scenario request failed', e.code, e.message);
      if (phase === 'loading') {
        dataError = e.code === 'scenario-missing' || e.code === 'scenario-invalid';
        if (e.code === 'manifest-invalid') needReload = manifestRejected = true;
        phase = 'failed';
      } else if (phase === 'ready' && !stopped) {
        // A failed reroll: the shown future stays.
        rerollBusy = false;
        rerollFailed = true;
        syncLevers();
      } // a failed crash-Retry keeps the chip and its Retry
    },
    onCrash() {
      if (dead) return;
      onclient?.(null);
      latest = null;
      rerollBusy = false;
      rerollFailed = false;
      if (phase === 'ready') {
        stopped = true;
        hideTooltip();
        refreshCard(); // "Details unavailable" until Retry
      } else {
        dataError = false;
        phase = 'failed';
      }
    }
  };

  async function retry(): Promise<void> {
    if (retrying || dead || !client) return;
    retrying = true;
    const wasReady = phase === 'ready';
    if (!wasReady) {
      phase = 'loading';
      dataError = false;
    }
    try {
      if (client.crashed) {
        client.restart(createWorker());
        resetChunkStatuses();
      }
      if (needReload || !manifest || !calibration) {
        const fresh = await reload();
        if (dead) return;
        // A new manifest object remounts SimMap's map: keep the mounted one for the same dataset,
        // unless the worker rejected it.
        if (
          manifestRejected ||
          !manifest ||
          fresh.manifest.datasetVersion !== manifest.datasetVersion
        ) {
          manifest = fresh.manifest;
        }
        manifestRejected = false;
        if (fresh.calibration !== calibration) {
          calibration = fresh.calibration;
          if (!wasReady) day = fresh.calibration.asOf;
          pushLookups();
          handle?.setTime(day);
        }
        needReload = false;
      }
      startScenario({ seed: client.currentSeed ?? urlSeed });
    } catch (e) {
      console.error('[fzp] retry failed', e);
      if (!dead && !wasReady) phase = 'failed';
    } finally {
      retrying = false;
    }
  }

  function onMapReady(h: SimMapHandle): void {
    if (dead) return;
    handle = h;
    pushLookups();
    const queued = pendingUpdates;
    pendingUpdates = [];
    for (const u of queued) h.applyTimeline(u);
    for (const [cellId, s] of pendingStatus) h.setChunkStatus(cellId, s);
    pendingStatus.clear();
    if (calibration) h.setTime(day);
    applyInset();
    h.onResyncNeeded(() => client?.resync());
    attachMap(h.getMap());
    flushPrefetch();
    const m = h.getMap();
    if (m) onmapready?.(h, m);
  }

  function requestParcelSummary(parcelId: string) {
    if (!client) return Promise.resolve(null);
    return client.parcelSummary(parcelId, day).then(
      (s) =>
        s && {
          parcelId: s.parcelId,
          eligible: s.eligible,
          ...(s.underwater ? { underwater: true } : {}),
          existingUnits: s.existingUnits,
          generated: null
        }
    );
  }

  useHeaderActions(headerActions, { pinned: scoreBar });

  onMount(() => {
    if (phase !== 'no-scenario') {
      const c = new ScenarioClient(createWorker(), events);
      client = c;
      clientApi = {
        resolveBrush: (q) => c.resolveBrush(q),
        brushCatalog: () => c.brushCatalog(),
        retryChunks: () => c.retryChunks()
      };
      if (phase === 'loading') startScenario({ seed: urlSeed });
    }

    applyInset();
    addEventListener('resize', publishDockTop);

    const uninstall = installFzpDebug(() => ({
      phase,
      seed,
      representative,
      day,
      asOf,
      horizon: HORIZON,
      playing,
      score,
      levers: {
        status: leverStatus.kind,
        done: leverStatus.kind === 'resolving' ? leverStatus.done : 0,
        total: leverStatus.kind === 'resolving' ? leverStatus.total : 0,
        sentRev: leverState.sentRev
      }
    }));

    return () => {
      dead = true;
      if (client) onclient?.(null);
      uninstall();
      removeEventListener('resize', publishDockTop);
      document.documentElement.style.removeProperty('--fzp-dock-top');
      playing = false;
      attachMap(null);
      client?.dispose();
      client = null;
      handle = null;
    };
  });
</script>

{#snippet headerActions()}
  {#if phase !== 'no-scenario'}
    {@render actions?.()}
    <button
      type="button"
      title="Show another possible future"
      disabled={!canReroll}
      aria-busy={rerollBusy}
      onclick={anotherFuture}
      class="min-h-6 min-w-6 rounded-md border border-gray-300 px-2 text-sm font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:text-gray-700 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
    >
      Another future
    </button>
  {/if}
{/snippet}

{#snippet scorePanel()}
  <FzpScorePanel
    {score}
    {at}
    {day}
    {asOf}
    horizon={HORIZON}
    {bandRuns}
    {bandRunsTotal}
    {seed}
    {representative}
    {canReroll}
    {datasetVersion}
    builtAt={manifest?.builtAt ?? ''}
    onrepresentative={() => requestReroll(null)}
    onsources={() => dialog?.open()}
    {copy}
    {capacity}
  />
{/snippet}

{#snippet scoreBar()}
  {#if hasScoreboard && calibration}
    <ScoreBar {score} {day} {playing} busy={scoreBusy} panel={scorePanel} />
  {/if}
{/snippet}

<div
  bind:this={rootEl}
  class="sfh-fzp relative h-full"
  style:--fzp-scrubber-h="{scrubberH + noticeH}px"
>
  {#if manifest}
    <SimMap
      {manifest}
      {requestParcelSummary}
      onRetryChunks={() => client?.retryChunks()}
      onready={onMapReady}
      view={{ transitStops: false, transitAccess: false }}
      timelinePick={onPick}
    />
  {:else}
    <div class="h-full" data-testid="fzp-frame"></div>
  {/if}

  <!-- Top-centre notices only where nothing else sits there. While loading, the header's score
       details open at the top right on md+, so the notice takes the top left (no card can be
       open yet). -->
  {#if phase === 'loading'}
    <div
      class="absolute top-4 left-1/2 z-30 -translate-x-1/2 md:left-[calc(var(--sim-panel-w,0px)+1rem)] md:translate-x-0"
    >
      <p
        role="status"
        data-testid="fzp-status"
        class="rounded-lg bg-white px-3 py-2 text-sm text-black shadow"
      >
        Loading the simulation…
      </p>
    </div>
  {:else if phase === 'failed'}
    <div
      class="absolute top-4 left-[calc(50%+var(--sim-panel-w,0px)/2)] z-30 flex w-max max-w-[calc(100%-32px-var(--sim-panel-w,0px))] -translate-x-1/2 items-center gap-2 rounded-lg bg-white py-1 pl-3 text-sm text-black shadow"
    >
      <p role="alert" data-testid="fzp-status">
        {dataError
          ? `The simulation data for dataset ${datasetVersion} is missing or damaged.`
          : "The simulation couldn't load."}
      </p>
      <button
        type="button"
        class="min-h-11 min-w-11 shrink-0 rounded-lg px-3 font-semibold underline"
        onclick={() => void retry()}>Retry</button
      >
    </div>
  {:else if phase === 'no-scenario'}
    <div
      role="status"
      data-testid="fzp-status"
      class="absolute top-4 left-1/2 z-30 w-[min(28rem,calc(100%-32px))] -translate-x-1/2 rounded-lg bg-white p-4 text-sm text-black shadow"
    >
      <p>
        The Family Zoning Plan timelapse isn't available for dataset {datasetVersion}. It needs
        simulation data that this dataset doesn't have.
      </p>
      <a href="/" class="mt-2 inline-flex min-h-11 items-center font-semibold underline"
        >Go to the editor</a
      >
    </div>
  {/if}

  {#if phase === 'ready' && calibration && cardChance}
    <!-- The posted lookups carry no calibration: lever timers rescale durations, not the
         provenance the card cites, so both cohorts cite the base calibration. -->
    <ProjectCardPanel
      state={cardState}
      {day}
      {asOf}
      calibration={{ inFlight: calibration, fresh: calibration }}
      chance={cardChance}
      onclose={closeCard}
      onsource={(id) => dialog?.open(id)}
    />
    <ProjectTooltip state={tipState} {day} x={tipAt.x} y={tipAt.y} />
    <!-- The ready-phase notices sit just above the scrubber. Their height joins the scrubber's
         in the map inset, --fzp-scrubber-h and --fzp-dock-top, so the card and the header's
         score details (at any width) always end above them and are never covered. -->
    <div
      class="pointer-events-none absolute inset-x-0 z-20 flex flex-col items-center px-4"
      style:bottom="{scrubberH}px"
      data-testid="fzp-notices"
      bind:offsetHeight={noticeH}
    >
      <div role="status" data-testid="fzp-status" class="max-w-full">
        {#if stopped}
          <span
            class="pointer-events-auto mb-2 flex w-max max-w-full items-center gap-1 rounded-full bg-white py-1 pl-4 text-sm text-black shadow"
          >
            <span>Part of the simulation stopped.</span>
            <button
              type="button"
              class="min-h-11 min-w-11 rounded-full px-3 font-semibold underline"
              onclick={() => void retry()}>Retry</button
            >
          </span>
        {:else if rerollBusy}
          <span
            class="pointer-events-auto mb-2 block rounded-lg bg-white px-3 py-2 text-sm text-black shadow"
            >Making another future…</span
          >
        {/if}
      </div>
      <!-- Lever notices (/sim): their own polite region, beside the reroll and crash ones. -->
      <div role="status" data-testid="fzp-lever-status" class="max-w-full">
        {#if leverStatus.kind === 'resolving' && !stopped}
          <span
            class="pointer-events-auto mb-2 block rounded-lg bg-white px-3 py-2 text-sm text-black shadow"
            >Updating the simulation for your policy…{leverStatus.total > 0
              ? ` ${formatCount(leverStatus.done)} of ${formatCount(leverStatus.total)} lots`
              : ''}</span
          >
          {#if leverStatus.failedCells.length > 0}
            <span
              class="pointer-events-auto mb-2 flex w-max max-w-full items-center gap-1 rounded-lg bg-white py-1 pl-3 text-sm text-black shadow"
            >
              <span>Some map data didn't load.</span>
              <button
                type="button"
                class="min-h-11 min-w-11 rounded-lg px-3 font-semibold underline"
                onclick={() => client?.retryChunks()}>Retry</button
              >
            </span>
          {/if}
        {/if}
      </div>
      {#if rerollFailed && !stopped}
        <div
          role="alert"
          class="pointer-events-auto mb-2 flex w-max max-w-full items-center gap-1 rounded-lg bg-white py-1 pl-3 text-sm text-black shadow"
        >
          <span>Couldn't make another future. Try again.</span>
          <button
            type="button"
            aria-label="Dismiss"
            class="min-h-11 min-w-11 rounded-lg px-3 font-semibold"
            onclick={() => (rerollFailed = false)}>×</button
          >
        </div>
      {/if}
    </div>
    <div class="absolute inset-x-0 bottom-0 z-20">
      <TimeScrubber
        {asOf}
        horizon={HORIZON}
        bind:day
        bind:playing
        bind:speed
        {markers}
        onday={onDay}
        onheight={(px) => {
          scrubberH = px;
          applyInset();
        }}
      />
    </div>
  {/if}

  {#if phase !== 'no-scenario'}
    {@render panel?.()}
  {/if}

  {#if calibration && phase !== 'no-scenario'}
    <SourcesDialog
      bind:this={dialog}
      {calibration}
      {score}
      projectsUrl={manifest?.scenarios?.fzp.projects ?? null}
      {asOf}
      onopen={() => (playing = false)}
    />
  {/if}
</div>
