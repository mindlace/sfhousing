<!--
  The timelapse composition (spec §4.1, §4.2, §4.3, §4.7, §4.8): SimMap, the time scrubber, the
  header score (HeaderScore, pinned in the header; it shows and hides the dock's Results), the project card and
  tooltip and the sources dialog, over timelapse-sim's ScenarioClient. Queueing before the map
  handle, chunk statuses and crash Retry mirror BrushEditor.svelte (copied, not imported). /sim
  passes `levers` (plan 3): the session runs the lever engine, and the worker's posted lookups
  replace the calibration's once current. /sim also passes `runPhase` (spec §1): in Setup the day
  is pinned at asOf and the scrubber's button reads Run; Run plays once the score is current.
-->
<script module lang="ts">
  import { chanceTable, typicalMonths } from '$lib/timelapse/model';
  import type { Calibration } from '$lib/timelapse/types';
  import type { SimMapHandle } from '$lib/map/types';
  import type { ParcelId } from '$lib/data/parcel';
  import type { BrushCatalog, BrushQuery } from '$lib/sim/levers/brushes';
  import type {
    BrushLotsResult,
    HeightLidsResult,
    LotAtResult,
    LotOutlinesResult,
    PreviewResult
  } from '$lib/sim/scenario/types';
  import type { LeverLookups } from '$lib/sim/levers/apply';
  import { medianRank } from '$lib/sim/scenario/band';
  import type { ChanceTable } from './card';

  type Lookups = { chance: ChanceTable; typicalMonths: ReturnType<typeof typicalMonths> };
  type MapLike = NonNullable<ReturnType<SimMapHandle['getMap']>>;

  /** What /sim's page needs from the scenario client (brush pickers and their Retry). */
  export interface SimClientApi {
    resolveBrush(q: BrushQuery): Promise<BrushLotsResult>;
    brushCatalog(): Promise<BrushCatalog | null>;
    lotOutlines(lots: ParcelId[]): Promise<LotOutlinesResult>;
    /** Paint feedback: the buildings `lots` could hold at `stories`. */
    previewBuildings(lots: ParcelId[], stories: number): Promise<PreviewResult>;
    /** The glass lids of the loaded lots in a view (lng/lat bbox), on the latest city. */
    heightLids(bbox: [number, number, number, number]): Promise<HeightLidsResult>;
    /** The lot under a point (lng, lat) and the layer that sets its limit, at once. */
    lotAt(point: [number, number]): Promise<LotAtResult>;
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

  type MapLookups = Lookups & { inFlight?: Lookups };
  /** One map lookups object per posted LeverLookups, for the same identity reason (Call 15). */
  const leverMapCache = new WeakMap<LeverLookups, MapLookups>();
  function mapLookupsFor(ll: LeverLookups): MapLookups {
    let l = leverMapCache.get(ll);
    if (!l) {
      l = { ...ll.fresh, inFlight: ll.inFlight };
      leverMapCache.set(ll, l);
    }
    return l;
  }
</script>

<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import type { Manifest } from '$lib/data/manifest';
  import type { HeightCity } from '$lib/map/height/types';
  import SimMap from '$lib/map/SimMap.svelte';
  import type { ChunkStatus, TimelinePick, TimelineUpdate } from '$lib/map/types';
  import { formatCount } from '$lib/scoreboard/format';
  import { useHeaderActions } from '$lib/shell/header-actions.svelte';
  import NoticePills from '$lib/shell/NoticePills.svelte';
  import { PILL, PILL_ACTION } from '$lib/shell/pill';
  import {
    leversError,
    leversMessage,
    leversSent,
    leversSession,
    type LeverStatusState
  } from '$lib/sim-page/lever-status';
  import { spawnSimWorker } from '$lib/sim/client';
  import type { LimitOwner } from '$lib/sim/levers/source';
  import type { SimLevers } from '$lib/sim/levers/types';
  import type { SimPhase } from '$lib/sim-page/run-phase.svelte';
  import { scoreCopy } from '$lib/sim-page/policy';
  import type { TimelineScore } from '$lib/sim/protocol';
  import {
    ScenarioClient,
    type ScenarioClientEvents,
    type ScenarioWorkerInput
  } from '$lib/sim/scenario-client';
  import type { Day } from '$lib/timelapse/time';
  import { installFzpDebug, type SfhFzpDebug } from './debug';
  import { HighWater } from './high-water.svelte';
  import HeaderScore from '$lib/scoreboard/HeaderScore.svelte';
  import SimResults from './SimResults.svelte';
  import { DEFAULT_SPEED } from './playback';
  import { BR_BLOCK, watchCardArea } from './card-area-watch';
  import { cardArea, cardPlacement, type CardArea } from './card-place';
  import ProjectCardPanel from './ProjectCardPanel.svelte';
  import ProjectTooltip from './ProjectTooltip.svelte';
  import RunSlider from './RunSlider.svelte';
  import { positionOfShown, requestSeed } from './run-slider';
  import { RunSwitcher } from './run-switch';
  import { RHNA_ID, homesAddedBy, scoreAt, scrubMarkers } from './score-view';
  import SourcesDialog from './SourcesDialog.svelte';
  import { SummaryRequester, type SummaryState } from './summary-request';
  import { HORIZON, monthIndex, monthStart } from './time';
  import TimeScrubber from './TimeScrubber.svelte';
  import type { FzpPhase, Speed } from './types';
  import { HIDDEN_VIEW, type ViewPrefs } from '$lib/view/prefs';

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
    /**
     * Only on a settled run switch's answer (the run slider, 'Back to the representative future',
     * a lever change's return to the representative future): its seed, null for the median.
     */
    onurlseed?: (seed: number | null) => void;
    /** Tests inject a fake worker. */
    createWorker?: () => ScenarioWorkerInput;
    /**
     * /sim only (absent = /fzp, unchanged): sent with every `initScenario`; a new object once the
     * scenario is live sends `setLevers`.
     */
    levers?: SimLevers;
    /** /sim: `levers` lacks its brush lots; the next initScenario asks the worker to wait. */
    leversIncomplete?: boolean;
    /**
     * /sim: a kept lever revision's height regions and contours (one `heights` per rev, before its
     * `current`); a revision below the latest levers sent is dropped.
     */
    onheights?: (c: HeightCity) => void;
    /** /sim: a chunk response arrived (lots may have loaded; the eraser outlines ask again). */
    onchunks?: () => void;
    /**
     * The client's brush requests on each new session (`initScenario`: mount, Retry), null on a
     * crash and on unmount. A call with the api means requests answered `no-session` before it
     * can be asked again.
     */
    onclient?: (api: SimClientApi | null) => void;
    /** SimMap's handle and map, once ready. */
    onmapready?: (h: SimMapHandle, map: MapLike) => void;
    /** Every phase change (/sim: the brush tools work once the scenario is ready). */
    onphase?: (p: FzpPhase) => void;
    /**
     * Rendered inside `.sfh-fzp` (the /sim dock). It is given the Results snippet (`SimResults`
     * with the scrubbed month's score) for the dock's Results face.
     */
    panel?: Snippet<[Snippet]>;
    /** The page's own header actions (/sim: "Policy"). */
    actions?: Snippet;
    /** The header's status slot (/sim: the save state); read once, at mount. */
    status?: Snippet;
    /**
     * The page's own notices (/sim: restore, refit, Remix), first among the ready-phase pills in
     * the notice stack (`NoticePills`); each should be a `PILL`.
     */
    notices?: Snippet;
    /**
     * /sim's phase (absent = /fzp, today's behaviour). In 'setup' playback stops and the day is
     * pinned at asOf (through `onDay`, as a scrubber jump); the scrubber's button reads Run.
     */
    runPhase?: SimPhase;
    /** The Run button's press; the page then moves `runPhase` to 'run'. */
    onrun?: () => void;
    /**
     * /sim: the viewer scrubbed back to Today during a run (Home, the Today marker, a key or drag
     * that lands on asOf); the page then returns to Setup. Never called by Replay or playback.
     */
    onrewind?: () => void;
    /**
     * /sim: newer levers are on their way (debounced, or their lots still being found). Run
     * waits for them, and the score bar shows the pending state.
     */
    leversPending?: boolean;
    /** The map's layer toggles (/sim: the viewer's in Setup, all off in a run). Default all off. */
    view?: ViewPrefs;
    /**
     * The manifest SimMap renders (null: none yet), once during setup and again whenever a Retry
     * replaces it, so the page can gate manifest-dependent UI (the View rows) on it.
     */
    onmanifest?: (m: Manifest | null) => void;
    /** The header score is pressed: the page shows or hides the dock's Results (/sim). */
    onscore?: () => void;
    /** The dock shows Results: the header score's `aria-expanded`. */
    scoreExpanded?: boolean;
    /** The dock's id: the header score's `aria-controls`. */
    scoreControls?: string;
    /**
     * Px added to the map's bottom inset over the scrubber (/sim below md: the dock's sheet, so
     * its handle never hides the attribution). Default 0.
     */
    bottomExtra?: number;
    /**
     * Taps open cards (default true): project cards and, on touch, SimMap's own (`tapCards`).
     * /sim passes `run.phase === 'run'`: in Set Policy a click selects a layer instead. Turning it
     * off closes an open card. Hover tooltips stay.
     */
    cards?: boolean;
    /**
     * What to call the layer that set a clicked lot's limit, for the card's "Allowed by" line
     * (/sim: a layer's name, "Painted 8 stories"); null shows no line (FZP, a removed layer).
     */
    ownerName?: (owner: LimitOwner, parcelId: ParcelId) => string | null;
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
    leversIncomplete = false,
    onheights = undefined,
    onclient = undefined,
    onmapready = undefined,
    onphase = undefined,
    panel = undefined,
    actions = undefined,
    status = undefined,
    notices = undefined,
    runPhase = undefined,
    onrun = undefined,
    onrewind = undefined,
    leversPending = false,
    view = HIDDEN_VIEW,
    onmanifest = undefined,
    onchunks = undefined,
    onscore = undefined,
    scoreExpanded = false,
    scoreControls = undefined,
    bottomExtra = 0,
    cards = true,
    ownerName = undefined
  }: Props = $props();

  // The props seed the page once; Retry replaces the manifest and calibration in place.
  let manifest = $state.raw<Manifest | null>(untrack(() => initialManifest));
  untrack(() => onmanifest?.(manifest));
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
  /** The furthest day reached: the results reveal nothing after it. Reset on entering Setup. */
  const highWater = new HighWater(untrack(() => day));
  let playing = $state(false);
  let speed = $state<Speed>(DEFAULT_SPEED);
  /** The worker crashed after ready: scrubbing still works; the chip offers Retry. */
  let stopped = $state(false);
  /** The latest run switch failed: the run on show stays, and a dismissible alert says so. */
  let switchFailed = $state(false);
  /**
   * The run slider's selected tick (0 = Best): moved at once on a select (the handle follows the
   * user), set from the run on show on each settled answer and each `ranks`; null when that run is
   * not one of the ranked runs, or before the band's order.
   */
  let position = $state<number | null>(null);
  let scrubberH = $state(0);

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
  /** The band's seeds, best first, for the current levers; null until its run finishes. */
  let ranks = $state.raw<number[] | null>(null);
  /**
   * The rev of the latest initScenario or setLevers sent: a `ranks` message below it is a stale
   * band. A reroll does not move it (a kept band's ranks arrive at the old rev, by design).
   */
  let ranksFloor = 0;
  /** The latest run switch's timing stamps (the e2e bench reads them). */
  let switchTrace = $state.raw<SfhFzpDebug['switchTrace']>(null);

  /**
   * Run was pressed: play as soon as the phase is 'run' and the score is current, for the latest
   * levers (none pending, none sent unanswered). While it waits the button still reads Run, so no
   * press can play an older timeline. Playback starting and Setup clear it.
   */
  let playWhenCurrent = $state(false);

  let cardState = $state.raw<SummaryState>({ kind: 'idle' });
  /**
   * The tap that opened the card: its point (map px), the place under it (the card follows it
   * across pans and zooms) and its lot. The card sits beside the point.
   */
  let cardTap = $state.raw<{
    x: number;
    y: number;
    lngLat: [number, number] | null;
    parcelId: ParcelId;
  } | null>(null);
  let cardSize = $state.raw<{ w: number; h: number } | null>(null);
  let cardBounds = $state.raw<CardArea | null>(null);
  let host = $state<HTMLElement>();
  let mapBox = $state<HTMLElement>();
  let pillsEl = $state<HTMLElement>();
  /** The run slider's positioned box, while it shows. */
  let sliderBox = $state<HTMLElement>();
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
  /**
   * The levers the score on show answers (/sim): set when a timeline arrives for their revision
   * or a later one, so the comparison copy never names the levers still being computed. Null
   * before the first timeline and on /fzp.
   */
  let shownLevers = $state.raw<SimLevers | null>(null);
  /** Who the plan effect is for: the Family Zoning Plan on /fzp and under its levers. */
  const copy = $derived(scoreCopy(shownLevers ?? levers ?? null));
  const capacity = $derived(leverStatus.kind === 'current' ? leverStatus.capacity : null);
  /**
   * The score on show is from before the latest levers until a timeline at or after their rev
   * arrives (a later reroll's runs on them too); a failed revision leaves the old score standing.
   */
  const scoreBusy = $derived(
    leverState.sentRev !== null && timelineRev < leverState.sentRev && leverStatus.kind !== 'failed'
  );
  /**
   * The latest revision failed (/sim): the score stands from the policy before it, the score
   * details say so, and the notice stack offers Retry, which restarts with the latest levers.
   */
  const leverFailed = $derived(leverStatus.kind === 'failed' && !stopped);
  const markers = $derived(score ? scrubMarkers(score) : []);
  /** The score at the scrubbed month, for the details panel. */
  const at = $derived(
    score ? scoreAt(score, monthIndex(day, score.months[0], score.months.length)) : null
  );
  /**
   * The header score's "vs FZP" delta: your policy's effect at the day, in a run that compares
   * with the Family Zoning Plan as written. A default-policy run compares the plan with the old
   * zoning, so "vs FZP" would mislabel it (the Results face states that comparison).
   */
  const scoreDelta = $derived(
    runPhase === 'run' && copy.compare === 'fzp' && at?.planCompleted != null
      ? at.planCompleted
      : null
  );
  const hasScoreboard = $derived(
    calibration !== null && (phase === 'loading' || phase === 'ready')
  );
  /** A run switch may be asked for (the slider, 'Back to the representative future'). */
  const canSwitch = $derived(phase === 'ready' && !stopped);

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
  let pushedLookups: MapLookups | null = null;
  /** The levers object the worker last received (identity), with initScenario or setLevers. */
  let sentLevers: SimLevers | null = null;
  /** Each revision's levers, oldest first, until a timeline at or after its rev arrives. */
  let leversByRev: { rev: number; levers: SimLevers }[] = [];
  /** A non-stale timeline has arrived since the last initScenario. */
  let scenarioLive = false;
  /** Prefetch the viewport on the first timeline after each initScenario. */
  let prefetchDue = false;
  let asOfChecked = false;
  /** The scrubbed month the open card was last requested for. */
  let cardMonth: Day | null = null;

  /**
   * The page's latest `initScenario`. `representative` is the flag its answer sets (null = keep).
   * A higher rev is the client's resync or a run switch (`runs`), which this does not answer.
   */
  let latest: {
    rev: number;
    /**
     * The highest barrier that answers this request: `rev`, or a `setLevers` sent before its
     * answer (the worker loads at it, so its timeline answers the init). Above it: a resync.
     */
    upTo: number;
    representative: boolean | null;
    answered: boolean;
  } | null = null;

  /** The rev of the latest switch sent; the in-flight one's while `runs` is not settled. */
  let switchRev = 0;
  /**
   * Run switches (the slider, 'Back to the representative future', a lever change's return to
   * the median): latest wins, one in flight. Each is a swap reroll, installed over the run on
   * the map.
   */
  const runs = new RunSwitcher((next) => {
    const rev = client!.reroll(next, { swap: true });
    switchRev = rev;
    switchTrace = {
      seed: next,
      rev,
      requestedAt: performance.now(),
      answeredAt: null,
      completeAt: null
    };
    return rev;
  });

  /** A pointer drag on the run slider is under way. */
  let dragging = false;
  /** The `?seed=` of the last switch answered, until it is written (null: a clean URL). */
  let urlDue: { seed: number | null } | null = null;

  /**
   * Writes the URL of the last switch answered once nothing waits behind it and no pointer drag
   * is under way (spec: "after the drag settles"), so a drag does not call `replaceState` per tick.
   */
  function writeUrl(): void {
    if (!urlDue || !runs.settled || dragging) return;
    const due = urlDue;
    urlDue = null;
    onurlseed?.(due.seed);
  }

  function ondrag(active: boolean): void {
    dragging = active;
    if (!active) writeUrl();
  }

  function setLeverState(next: LeverStatusState): void {
    if (next === leverState) return;
    leverState = next;
  }

  /**
   * The T9 seam (spec §5): every `initScenario` goes through here, with the current `levers` on
   * /sim. A request for the future already shown (crash Retry) keeps the representative flag; a
   * null seed is the representative future.
   */
  function startScenario({ seed: next }: { seed: number | null }): void {
    if (!client || !manifest) return;
    const [l, incomplete] = untrack(() => [levers, leversIncomplete] as const);
    const rev = client.initScenario(manifest, HORIZON, next, l, incomplete);
    ranksFloor = rev;
    ranks = null;
    position = null;
    runs.reset();
    switchFailed = false;
    if (next !== seed) urlDue = null; // another future than the one a switch showed
    if (l !== undefined) {
      sentLevers = l;
      leversByRev.push({ rev, levers: l });
      setLeverState(leversSession(leverState, rev));
    }
    if (clientApi) onclient?.(clientApi);
    const keep = next !== null && next === seed;
    latest = {
      rev,
      upTo: rev,
      representative: keep ? null : next === null,
      answered: false
    };
    scenarioLive = false;
    prefetchDue = true;
  }

  /**
   * Sends a new `levers` object once a session was started, before its first timeline too (an
   * `awaitLevers` session runs nothing until it). Not after a crash, after a failed load or
   * during a Retry (no session to take it: Retry sends the latest levers with its initScenario).
   * It never waits for a run switch. Sent before the init's answer, its barrier answers the init
   * (`latest.upTo`): the worker's first timeline comes at it. Once the scenario is live, the old
   * band's order is dropped (rank r is another run under new levers) and the slider goes back to
   * the median: a switch in flight or a run other than the representative is replaced by the
   * representative future, whose answer writes the clean URL. Before then (an `awaitLevers`
   * session) nothing else changes, so a `?seed=` survives.
   */
  function syncLevers(): void {
    const l = untrack(() => levers);
    if (l === undefined || l === sentLevers || dead || !client || client.crashed) return;
    if (latest === null || phase === 'failed' || retrying) return;
    sentLevers = l;
    const rev = client.setLevers(l);
    ranksFloor = rev;
    ranks = null;
    if (!latest.answered) latest.upTo = rev;
    leversByRev.push({ rev, levers: l });
    setLeverState(leversSent(leverState, rev));
    if (!scenarioLive) return;
    position = null;
    switchFailed = false;
    const back = !representative || !runs.settled;
    runs.reset();
    if (back) runs.select(null);
  }

  /** A timeline at `rev` answers the latest levers sent at or before it. */
  function answerLevers(rev: number): void {
    let i = -1;
    while (i + 1 < leversByRev.length && leversByRev[i + 1].rev <= rev) i++;
    if (i < 0) return;
    shownLevers = leversByRev[i].levers;
    leversByRev = leversByRev.slice(i + 1);
  }

  $effect(() => {
    void levers;
    untrack(syncLevers);
  });

  /**
   * The run slider's select (and `__sfhFzp.selectRank`): shows the run at tick `p` of the band
   * (0 = Best); the median tick is the representative future, a null seed. The handle moves at
   * once; the switch is latest-wins.
   */
  function onselect(p: number): void {
    const r = ranks;
    if (!r || !client || !canSwitch || p < 0 || p >= r.length) return;
    position = p;
    switchFailed = false;
    runs.select(requestSeed(r, p));
  }

  /** 'Back to the representative future': the slider's median, or a null seed before ranks. */
  function backToRepresentative(): void {
    if (!client || !canSwitch) return;
    if (ranks) return onselect(medianRank(ranks.length));
    switchFailed = false;
    runs.select(null);
  }

  /** The tick of the run on show, once the band's order is known. */
  function shownPosition(): number | null {
    return ranks ? positionOfShown(ranks, seed, representative) : null;
  }

  function pushLookups(): void {
    if (!handle || !calibration) return;
    // T9 lookups seam (spec §5): the page builds chanceTable and typicalMonths from the base
    // calibration.json until a lever revision is current; then the worker's posted lookups
    // replace them (/sim). The map takes the new projects' set with the in-flight one as
    // `inFlight` (Call 15), one object per posted lookups; the card picks its cohort's from
    // `cardChance`.
    const l = leverLookups ? mapLookupsFor(leverLookups) : lookupsFor(calibration);
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

  /** The open card asks again for the scrubbed day (month change, run switch, Retry, crash). */
  function refreshCard(): void {
    const q = cardReq.query;
    if (!q || cardState.kind === 'idle') return;
    cardMonth = monthStart(day);
    cardReq.request({ ...q, day });
  }

  function closeCard(): void {
    cardReq.reset();
    cardMonth = null;
    cardTap = null;
  }

  /** The room for the card now: beside the dock, the zoom controls and the run slider, over the
   *  time bar and the attribution, under any showing pill. */
  function measureCardArea(scrubber = scrubberH): void {
    if (!host || !mapBox) return;
    const dock = parseFloat(getComputedStyle(host).getPropertyValue('--dock-w')) || 0;
    const m = mapBox.getBoundingClientRect();
    // MapLibre's bottom-left controls (fine pointers; zero-sized when hidden) and the bottom-right
    // footprint SimMap publishes on :root, measured from the map's bottom.
    const zoom = mapBox.querySelector('.maplibregl-ctrl-bottom-left')?.getBoundingClientRect();
    const br = parseFloat(document.documentElement.style.getPropertyValue(BR_BLOCK)) || 0;
    const runBox = sliderBox?.getBoundingClientRect();
    const next = cardArea(
      { left: m.left, top: m.top, width: m.width, height: m.height },
      pillsEl ? pillsEl.getBoundingClientRect() : null,
      dock,
      scrubber,
      {
        left: zoom && zoom.width > 0 ? zoom.right - m.left : 0,
        bottom: br,
        right: runBox && runBox.width > 0 ? m.right - runBox.left : 0
      }
    );
    const was = cardBounds;
    if (
      was &&
      was.left === next.left &&
      was.top === next.top &&
      was.right === next.right &&
      was.bottom === next.bottom
    )
      return;
    cardBounds = next;
  }

  const cardOpen = $derived(cardState.kind !== 'idle');
  const wide = new MediaQuery('(min-width: 768px)');
  /**
   * The run slider: in a run, once ready; hidden while the phone card sheet is open (below
   * 768 px the card is a bottom sheet over the map).
   */
  const showRunSlider = $derived(
    runPhase === 'run' && phase === 'ready' && calibration !== null && (wide.current || !cardOpen)
  );
  // While a card is open its room is followed, by the few things that change it and nothing that
  // plays (`watchCardArea`); and it follows its building across pans and zooms. The slider
  // showing or hiding re-runs this.
  $effect(() => {
    if (!cardOpen || !mapBox) return;
    const bar = scrubberH;
    const slider = sliderBox;
    untrack(() => measureCardArea(bar));
    const stop = watchCardArea(
      {
        map: mapBox,
        pills: pillsEl,
        dock: mapBox.querySelector<HTMLElement>('[data-testid="dock"]'),
        controls: mapBox.querySelector<HTMLElement>('.maplibregl-ctrl-bottom-left'),
        slider
      },
      () => measureCardArea()
    );
    return stop;
  });
  $effect(() => {
    const m = map;
    if (!cardOpen || !m) return;
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const tap = cardTap;
        if (!tap?.lngLat) return;
        const at = m.project(tap.lngLat);
        if (at.x !== tap.x || at.y !== tap.y) cardTap = { ...tap, x: at.x, y: at.y };
      });
    };
    m.on('move', follow);
    return () => {
      cancelAnimationFrame(frame);
      m.off('move', follow);
    };
  });
  const cardAnchor = $derived.by(() => {
    if (!cardTap || !cardSize || !cardBounds) return null;
    const { left, top } = cardPlacement({ x: cardTap.x, y: cardTap.y }, cardSize, cardBounds);
    return { left, top, maxHeight: Math.max(0, cardBounds.bottom - cardBounds.top - 16) };
  });
  const cardAllowedBy = $derived.by(() => {
    const owner = cardState.kind === 'project' ? cardState.limits?.owner : undefined;
    return owner && cardTap && ownerName ? ownerName(owner, cardTap.parcelId) : null;
  });

  function hideTooltip(): void {
    tipReq.reset();
  }

  // Cards turned off (/sim's Set Policy): an open card closes.
  $effect(() => {
    if (!cards) untrack(closeCard);
  });

  function onPick(p: TimelinePick): void {
    // Without cards a tap is not this component's (/sim selects a layer): hover still shows tips.
    if (p.kind === 'tap' && !cards) return;
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
    const at = map?.unproject([p.x, p.y]);
    cardTap = {
      x: p.x,
      y: p.y,
      lngLat: at ? [at.lng, at.lat] : null,
      parcelId: p.parcelId
    };
    cardReq.request(q);
  }

  /** The scrubber's day changed (once per change): O(1) work. */
  function onDay(d: Day): void {
    handle?.setTime(d);
    if (cardMonth !== null && monthStart(d) !== cardMonth) refreshCard();
  }

  function onRun(): void {
    if (playWhenCurrent) return; // already waiting
    playWhenCurrent = true;
    if (runPhase !== 'run') onrun?.();
  }

  // The mark follows every write to `day` (playback, scrubbing and the Retry path alike).
  $effect(() => {
    const d = day;
    untrack(() => highWater.reach(d));
  });

  // Setup (spec §1): no playback, and the day pinned at asOf, moved as a scrubber jump moves it.
  // The high-water mark goes back to asOf with it (Edit policy and Today both land here).
  $effect(() => {
    if (runPhase !== 'setup') return;
    const a = asOf;
    const d = day;
    void playing;
    untrack(() => {
      if (playing) playing = false;
      if (d !== a) {
        day = a;
        onDay(a);
      }
      highWater.reset(a);
    });
  });

  // Back to Setup drops a pending Run.
  $effect(() => {
    if (runPhase === 'setup') untrack(() => (playWhenCurrent = false));
  });

  // Run plays once the score is current for the latest levers.
  $effect(() => {
    if (!playWhenCurrent) return;
    if (playing) {
      playWhenCurrent = false;
      return;
    }
    if (runPhase !== 'run' || phase !== 'ready' || scoreBusy || leversPending) return;
    playWhenCurrent = false;
    playing = true;
  });

  function applyInset(): void {
    handle?.setBottomInset(scrubberH + untrack(() => bottomExtra));
  }

  // The page's extra inset (the phone sheet) moves the map's bottom edge as the scrubber does.
  let lastExtra = untrack(() => bottomExtra);
  $effect(() => {
    const extra = bottomExtra;
    if (extra === lastExtra) return;
    lastExtra = extra;
    untrack(applyInset);
  });

  const events: ScenarioClientEvents = {
    onTimeline(t) {
      if (dead || !client || client.isStale(t)) return;
      timelineRev = t.rev;
      if (switchTrace !== null && t.rev === switchTrace.rev && switchTrace.completeAt === null) {
        const now = performance.now();
        switchTrace = {
          ...switchTrace,
          answeredAt: switchTrace.answeredAt ?? now,
          completeAt: t.complete ? now : null
        };
      }
      applyRender(t.render);
      score = t.score;
      answerLevers(t.rev);
      seed = t.seed;
      bandRuns = t.bandRuns;
      bandRunsTotal = t.bandRunsTotal;
      checkAsOf(t.score);
      const req = latest;
      const answer = req !== null && !req.answered && t.rev >= req.rev && t.rev <= req.upTo;
      if (answer) {
        req.answered = true;
        if (req.representative !== null) representative = req.representative;
        stopped = false;
        if (runs.settled) position = shownPosition();
      } else if (req !== null && !req.answered && t.rev > req.upTo) {
        // A later barrier (the client's resync, a switch) superseded the init: its answer will be
        // stale, and the flag stays.
        req.answered = true;
      }
      // A run switch: `pending` is the in-flight switch's rev. A timeline above it is the client's
      // resync, which showed the run already on show, so the flag and the URL stay.
      const pending = runs.settled ? null : switchRev;
      const done = runs.answer(t.rev);
      const switched = done !== undefined && t.rev === pending;
      if (switched) {
        representative = done.seed === null;
        switchFailed = false;
        urlDue = { seed: done.seed === null ? null : t.seed };
      }
      if (done && runs.settled) {
        position = shownPosition();
        writeUrl();
      }
      if (phase === 'loading') phase = 'ready';
      else if (answer || done) refreshCard();
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
    onRanks(m) {
      if (dead) return;
      if (m.rev < ranksFloor) return;
      ranks = m.seeds;
      if (runs.settled) position = shownPosition();
      // Unsettled, a null position means a switch to the representative future (a null seed) is
      // in flight or waiting: the handle sits on the median, where that switch lands.
      else if (position === null) position = medianRank(m.seeds.length);
    },
    onHeights(m) {
      if (dead) return;
      const sent = leverState.sentRev;
      if (sent !== null && m.rev >= sent) onheights?.(m.city);
    },
    onChunks(c) {
      if (dead) return;
      for (const [cellId, s] of Object.entries(c.status)) setChunkStatus(cellId, s);
      cardReq.retryIfNotLoaded(day);
      tipReq.retryIfNotLoaded(day);
      onchunks?.();
    },
    onError(e) {
      if (dead) return;
      setLeverState(leversError(leverState, e.rev, e.code));
      if (!runs.settled && e.rev === switchRev) {
        // A failed run switch: the run on show stays (a waiting one goes out).
        console.error('[fzp] run switch failed', e.code, e.message);
        runs.fail(e.rev);
        switchFailed = true;
        if (runs.settled) position = shownPosition();
        return;
      }
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
        // A failed lever Retry: the shown future stays (the lever status says so).
        syncLevers();
      } // a failed crash-Retry keeps the chip and its Retry
    },
    onCrash() {
      if (dead) return;
      onclient?.(null);
      latest = null;
      runs.reset();
      switchFailed = false;
      position = shownPosition();
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
          onmanifest?.(manifest);
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
          generated: null,
          ...(s.limits ? { limits: s.limits } : {})
        }
    );
  }

  useHeaderActions(headerActions, { pinned: scoreBar, status: untrack(() => status) });

  $effect(() => {
    const p = phase;
    untrack(() => onphase?.(p));
  });

  onMount(() => {
    if (phase !== 'no-scenario') {
      const c = new ScenarioClient(createWorker(), events);
      client = c;
      clientApi = {
        resolveBrush: (q) => c.resolveBrush(q),
        brushCatalog: () => c.brushCatalog(),
        lotOutlines: (lots) => c.lotOutlines(lots),
        previewBuildings: (lots, stories) => c.previewBuildings(lots, stories),
        heightLids: (bbox) => c.heightLids(bbox),
        lotAt: (point) => c.lotAt(point),
        retryChunks: () => c.retryChunks()
      };
      if (phase === 'loading') startScenario({ seed: urlSeed });
    }

    applyInset();

    const uninstall = installFzpDebug(() => ({
      phase,
      seed,
      representative,
      day,
      highWater: highWater.value,
      asOf,
      horizon: HORIZON,
      playing,
      speed,
      score,
      runPhase: runPhase ?? null,
      levers: {
        status: leverStatus.kind,
        done: leverStatus.kind === 'resolving' ? leverStatus.done : 0,
        total: leverStatus.kind === 'resolving' ? leverStatus.total : 0,
        sentRev: leverState.sentRev
      },
      ranks,
      selectRank: onselect,
      switchTrace
    }));

    return () => {
      dead = true;
      if (client) onclient?.(null);
      uninstall();
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
  {/if}
{/snippet}

{#snippet results()}
  <SimResults
    {score}
    {at}
    {day}
    {asOf}
    horizon={HORIZON}
    highWater={highWater.value}
    {bandRuns}
    {bandRunsTotal}
    {seed}
    {representative}
    {canSwitch}
    {datasetVersion}
    builtAt={manifest?.builtAt ?? ''}
    onrepresentative={backToRepresentative}
    onsources={() => dialog?.open()}
    {copy}
    {capacity}
    stale={leverFailed}
  />
{/snippet}

{#snippet scoreBar()}
  {#if hasScoreboard && calibration}
    <HeaderScore
      total={at?.total ?? null}
      target={at?.targets.find((t) => t.tp.target.id === RHNA_ID)?.tp ?? null}
      delta={scoreDelta}
      busy={scoreBusy || leversPending}
      expanded={scoreExpanded}
      controls={scoreControls ?? ''}
      onclick={() => onscore?.()}
      live={at ? homesAddedBy(day, at) : ''}
      quiet={playing}
    />
  {/if}
{/snippet}

<div
  bind:this={host}
  class="sfh-fzp sfh-dock-host relative flex h-full flex-col"
  style:--fzp-scrubber-h="{scrubberH}px"
>
  <!-- Every notice is a pill in this one stack: an overlay at the map's top from md (it takes no
       space, so nothing moves when one shows), in flow under the header below md. -->
  <NoticePills bind:el={pillsEl}>
    {#if phase === 'loading'}
      <p role="status" data-testid="fzp-status" class="{PILL} pr-4">Loading the simulation…</p>
    {:else if phase === 'failed'}
      <div class={PILL}>
        <p role="alert" data-testid="fzp-status">
          {dataError
            ? `The simulation data for dataset ${datasetVersion} is missing or damaged.`
            : "The simulation couldn't load."}
        </p>
        <button type="button" class="shrink-0 {PILL_ACTION}" onclick={() => void retry()}
          >Retry</button
        >
      </div>
    {:else if phase === 'no-scenario'}
      <!-- A sentence and a link do not fit one pill line at 375 px: the same surface, as a card. -->
      <div
        role="status"
        data-testid="fzp-status"
        class="{PILL} w-[min(28rem,100%)]! flex-col! items-start! gap-0! rounded-lg! pr-4 pb-0"
      >
        <p>
          The Family Zoning Plan timelapse isn't available for dataset {datasetVersion}. It needs
          simulation data that this dataset doesn't have.
        </p>
        <a href="/" class="inline-flex min-h-11 items-center font-semibold underline"
          >Go to the editor</a
        >
      </div>
    {/if}

    {#if phase === 'ready' && calibration && cardChance}
      {@render notices?.()}
      <div role="status" data-testid="fzp-status" class="contents">
        {#if stopped}
          <span class={PILL}>
            <span>Part of the simulation stopped.</span>
            <button type="button" class={PILL_ACTION} onclick={() => void retry()}>Retry</button>
          </span>
        {/if}
      </div>
      <!-- Lever notices (/sim): their own polite region, beside the crash one. -->
      <div role="status" data-testid="fzp-lever-status" class="contents">
        {#if leverStatus.kind === 'resolving' && !stopped}
          <span class="{PILL} pr-4"
            >Updating the simulation for your policy…{leverStatus.total > 0
              ? ` ${formatCount(leverStatus.done)} of ${formatCount(leverStatus.total)} lots`
              : ''}</span
          >
          {#if leverStatus.failedCells.length > 0}
            <span class={PILL}>
              <span>Some map data didn't load.</span>
              <button type="button" class={PILL_ACTION} onclick={() => client?.retryChunks()}
                >Retry</button
              >
            </span>
          {/if}
        {/if}
      </div>
      <!-- A failed lever revision (/sim only). The alert region is always rendered on /sim (empty
           when not failed), so it stays in the accessibility tree and its message is announced. -->
      {#if levers !== undefined}
        <div role="alert" data-testid="fzp-lever-failed" class="contents">
          {#if leverFailed}
            <span class={PILL}>
              <span>Couldn't update the simulation for your policy.</span>
              <button type="button" class={PILL_ACTION} onclick={() => void retry()}>Retry</button>
            </span>
          {/if}
        </div>
      {/if}
      {#if switchFailed && !stopped}
        <div role="alert" class={PILL}>
          <span>Couldn't show that future. Try again.</span>
          <button
            type="button"
            aria-label="Dismiss"
            class={PILL_ACTION}
            onclick={() => (switchFailed = false)}>×</button
          >
        </div>
      {/if}
    {/if}
  </NoticePills>

  <!-- The map and everything positioned over it: the stack above is not part of its box. -->
  <div bind:this={mapBox} class="relative min-h-0 flex-1">
    {#if manifest}
      <SimMap
        {manifest}
        {requestParcelSummary}
        onRetryChunks={() => client?.retryChunks()}
        onready={onMapReady}
        {view}
        timelinePick={onPick}
        tapCards={cards}
      />
    {:else}
      <div class="h-full" data-testid="fzp-frame"></div>
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
        anchor={cardAnchor}
        allowedBy={cardAllowedBy}
        onsize={(s) => (cardSize = s)}
      />
      <ProjectTooltip state={tipState} {day} x={tipAt.x} y={tipAt.y} />
      <div class="absolute inset-x-0 bottom-0 z-20">
        <TimeScrubber
          {asOf}
          horizon={HORIZON}
          bind:day
          bind:playing
          bind:speed
          {markers}
          setup={runPhase === 'setup' || playWhenCurrent}
          busy={playWhenCurrent}
          onrun={onRun}
          startLabel={runPhase ? 'Today' : undefined}
          ontoday={() => runPhase === 'run' && onrewind?.()}
          onday={onDay}
          onheight={(px) => {
            scrubberH = px;
            applyInset();
          }}
        />
      </div>
    {/if}

    {#if showRunSlider}
      <!-- The run slider (/sim in a run): on the map's right edge, its bottom above the
           bottom-right controls' footprint, which already includes the scrubber and the phone
           sheet (docs/dev/map-interfaces.md). Its width is the handle's touch target. -->
      <div
        bind:this={sliderBox}
        data-testid="run-slider-box"
        class="absolute top-2 right-2 z-20"
        style:bottom="calc(var(--map-controls-br-block-size, 60px) + 0.5rem)"
      >
        <RunSlider
          {ranks}
          {position}
          shownSeed={seed}
          disabled={!canSwitch || ranks === null}
          {onselect}
          {ondrag}
        />
      </div>
    {/if}

    {#if phase !== 'no-scenario'}
      {@render panel?.(results)}
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
</div>
