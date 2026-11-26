<!--
  The /sim and /s/<id> composition on the timeline (timeline-ui rules 1, 18-36): the header score
  and the status slot, the notice stack, the map with the project card and tooltip, and under the
  map the bottom pane: the timeline (the playhead, the chart and the rows) beside the detail
  column (the inspector, Details, or at rest Activity; a sheet on a phone), over a
  `TimelineSession`. The load states before the worker are its own (rule 30). The policy store and
  its editors are the page's: edits arrive as a new `policy`, their lots as a new `lots`
  (PolicySync).
-->
<script module lang="ts">
  import { chanceTable, typicalMonths } from '$lib/timelapse/model';
  import type { Calibration } from '$lib/timelapse/types';
  import type { SimMapHandle } from '$lib/map/types';
  import { moreBelow } from '$lib/shell/more-below';
  import type { ParcelId } from '$lib/data/parcel';
  import type { BrushCatalog, BrushQuery } from '$lib/sim/levers/brushes';
  import type {
    BrushLotsResult,
    HeightLidsResult,
    LotAtResult,
    LotOutlinesResult,
    PreviewResult
  } from '$lib/sim/scenario/types';
  import type { LeverLookups, Lookups } from '$lib/sim/levers/apply';
  import { lotsText } from '$lib/paint/rows';
  import { scoreCopy, type ScoreCopy } from '$lib/sim-page/policy';
  import type { SimLevers } from '$lib/sim/levers/types';

  export type MapLike = NonNullable<ReturnType<SimMapHandle['getMap']>>;

  /** What /sim's page needs from the timeline client (brush pickers, outlines, the map tap). */
  export interface TimelineClientApi {
    resolveBrush(q: BrushQuery): Promise<BrushLotsResult>;
    brushCatalog(): Promise<BrushCatalog | null>;
    lotOutlines(lots: ParcelId[]): Promise<LotOutlinesResult>;
    /** Paint feedback: the buildings `lots` could hold at `stories`. */
    previewBuildings(lots: ParcelId[], stories: number): Promise<PreviewResult>;
    /** The glass lids of the loaded lots in a view (lng/lat bbox), for the last view month. */
    heightLids(bbox: [number, number, number, number]): Promise<HeightLidsResult>;
    /** The lot under a point (lng, lat) and the policy that sets its limit, at once. */
    lotAt(point: [number, number]): Promise<LotAtResult>;
    retryChunks(): void;
  }

  /**
   * One lookups object per calibration object: SimMap compares lookups by identity, and nothing
   * may mutate them.
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
  /** One map lookups object per posted LeverLookups, for the same identity reason (rule 20). */
  const leverMapCache = new WeakMap<LeverLookups, MapLookups>();
  function mapLookupsFor(ll: LeverLookups): MapLookups {
    let l = leverMapCache.get(ll);
    if (!l) {
      l = { ...ll.fresh, inFlight: ll.inFlight };
      leverMapCache.set(ll, l);
    }
    return l;
  }

  /**
   * Who the plan effect is for (rule 26), in `scoreCopy`'s wording: current law vs the old zoning
   * when nothing is in force, else your policy vs current law. The worker's `compare` is not used.
   */
  function copyOf(nothing: boolean): ScoreCopy {
    return scoreCopy(nothing ? null : ({ compare: 'fzp' } as SimLevers));
  }

  /** Below md the inspector sheet starts under the chart, and is never shorter than this. */
  const MIN_SHEET = 240;

  /**
   * Px of rows the pinned block must leave in its box (a 24 px row target with room around it);
   * with less (a short window or browser zoom) the block and the rows are one piece that the
   * page's box scrolls, so a focused row always shows (WCAG 2.2 2.4.11, 1.4.10).
   */
  const MIN_ROWS = 64;

  /** The brush-failure notice: the editors' own words for a query that failed. */
  const LOTS_FAILED = lotsText({ kind: 'failed', keys: [] });
</script>

<script lang="ts">
  import { onMount, tick, untrack, type Snippet } from 'svelte';
  import { MediaQuery, SvelteSet } from 'svelte/reactivity';
  import type { Manifest } from '$lib/data/manifest';
  import { cardFunding, type CardFunding } from '$lib/fzp/card';
  import { BR_BLOCK, watchCardArea } from '$lib/fzp/card-area-watch';
  import { cardArea, cardPlacement, type CardArea } from '$lib/fzp/card-place';
  import { installFzpDebug } from '$lib/fzp/debug';
  import { DEFAULT_SPEED } from '$lib/fzp/playback';
  import ProjectCardPanel from '$lib/fzp/ProjectCardPanel.svelte';
  import ProjectTooltip from '$lib/fzp/ProjectTooltip.svelte';
  import { provenanceSections } from '$lib/fzp/provenance';
  import AboutDialog from '$lib/about/AboutDialog.svelte';
  import { SummaryRequester, type SummaryState } from '$lib/fzp/summary-request';
  import { monthStart } from '$lib/fzp/time';
  import type { FzpPhase, Speed } from '$lib/fzp/types';
  import { TODAY, defaultGoal, goalStep, type Goal } from '$lib/goal/goal';
  import type { HeightCity } from '$lib/map/height/types';
  import SimMap from '$lib/map/SimMap.svelte';
  import type { ChunkStatus, TimelinePick, TimelineUpdate } from '$lib/map/types';
  import { useHeaderActions } from '$lib/shell/header-actions.svelte';
  import NoticePills from '$lib/shell/NoticePills.svelte';
  import Message from '$lib/shell/Message.svelte';
  import { BUTTON_QUIET } from '$lib/shell/ui';
  import { spawnSimWorker } from '$lib/sim/client';
  import { MARKET_TERMS, resolveTerms } from '$lib/sim/finance';
  import type { LimitOwner } from '$lib/sim/levers/source';
  import type { ProjectCard } from '$lib/sim/protocol';
  import type { ScenarioWorkerInput } from '$lib/sim/scenario-client';
  import { TimelineClient, WINDOW_MONTHS } from '$lib/sim/timeline-client';
  import { monthLastDay } from '$lib/sim/world/months';
  import type { Day } from '$lib/timelapse/time';
  import { HIDDEN_VIEW, type ViewPrefs } from '$lib/view/prefs';
  import ChartRow from './ChartRow.svelte';
  import type { ChartLens } from './chart-lens';
  import SimDetails from './SimDetails.svelte';
  import SimActivity from './SimActivity.svelte';
  import {
    activityTotals,
    eventText,
    moneyInForce,
    startersFor,
    type ActivityItem
  } from './activity-view';
  import { ACTIVITY_LIMIT, ActivityIndex, type ActivityEvent } from './activity';
  import { loadPlaces, placeOf } from './places';
  import { datasetUrl } from '$lib/sim/scenario/load';
  import type { NeighborhoodShapes } from '$lib/sim/levers/brushes';
  import type { AddChoice } from './add';
  import { CHANGE_NOT_APPLIED, STALE_NOTE, UPDATING, WAITING_NOTE } from './copy';
  import Explain from './Explain.svelte';
  import Playhead from './Playhead.svelte';
  import { isPlayKey } from './shortcuts';
  import { clampDay, filledEndDay, indexOfDay, viewMonthOf } from './playhead';
  import { termsInForce } from './lens';
  import { nothingInForce, type PolicyKind, type SimPolicy4 } from './policy4';
  import { awaitsView, goalOutcome, outcomeKey, outcomeText, type GoalOutcome } from './outcome';
  import { levelSet } from './pool-level';
  import { editedReveal, moved, revealOpen, scanned, type Reveal } from './reveal';
  import {
    headlineAt,
    headlineSpoken,
    headlineText,
    playheadAt,
    resultsAt,
    scoreOfView,
    todayAt
  } from './results';
  import { TimelineSession, type Lots, type SessionNotice } from './session.svelte';
  import type { SpanRef } from './spans';
  import Timeline from './Timeline.svelte';
  import TimelineHeaderScore from './TimelineHeaderScore.svelte';
  import MapKeyControl from '$lib/map/key/MapKeyControl.svelte';
  import { keyTally } from './key';
  import SimKey from './SimKey.svelte';
  import { NODES } from '$lib/game/catalogue/nodes';
  import { RUNGS, goalAt, ladder } from '$lib/game/ladder';
  import { OPEN_LIMITS } from '$lib/game/limits';
  import { sideShown, type SideGoal } from '$lib/game/side-goals';
  import type { GameStore } from '$lib/game/store.svelte';
  import GoalHeadline from '$lib/game/ui/GoalHeadline.svelte';
  import { goalUnlocks } from './game-copy';
  import type { CameraFrame } from '$lib/map/types';

  interface Props {
    manifest: Manifest | null;
    manifestError: boolean;
    calibration: Calibration | null;
    calibrationError: boolean;
    noScenario: boolean;
    datasetVersion: string;
    /** Retry before the worker: reloads the manifest and calibration; rejects on any failure. */
    reload(): Promise<{ manifest: Manifest; calibration: Calibration }>;
    /** Tests inject a fake worker. */
    createWorker?: () => ScenarioWorkerInput;
    /** The map's layer toggles. Default all off. */
    view?: ViewPrefs;
    /** Taps open project cards (default true); off, a tap is the page's (a paint tool). */
    cards?: boolean;
    /** The card's "Allowed by" line: the policy that set a clicked lot's limit (`ownerName4`). */
    ownerName?: (owner: LimitOwner, parcelId: ParcelId) => string | null;
    /** The card's "Funded by" line (`fundingName4`). */
    fundingName?: (f: CardFunding) => string | null;
    /** The page's own header actions. */
    actions?: Snippet;
    /** The map's layer switches, in the map toolbar's Layers panel; no Layers toggle without. */
    layers?: Snippet;
    /**
     * The page's status (the save state), in the header's status slot. Its argument is true while
     * "Updating" covers it (the cell hides it): its controls should go inert and a popover of its
     * own close, while a live region of its own sets `visibility: visible` to keep speaking.
     */
    status?: Snippet<[covered: boolean]>;
    /** Autosave is off: "Updating" sits beside the save state instead of covering it. */
    saveOff?: boolean;
    /** The page's own notices, first in the notice stack; each should be a `Message`. */
    notices?: Snippet;
    /** The document on show (the rows); a new object after open is an edit (rule 25). */
    policy: SimPolicy4;
    /**
     * The document the worker runs, when it is not `policy` (the playable document in a game); a
     * new object after open is an edit. Default `policy`.
     */
    run?: SimPolicy4;
    /**
     * The game: the goal in play (its rung's), the header's goal headline in place of the score,
     * no goal notice, and the limits the timeline holds to. The open game (`game.open`) is no
     * game: today's page. Default null.
     */
    game?: GameStore | null;
    /**
     * The goal's amount. In a game, over `goalAt` of the rung in play (the `goal` seam is not
     * read); without one, over the default goal (the `goal` seam wins). Default null: the
     * default's.
     */
    goalAmount?: number | null;
    /** Edit mode: the camera the map opens on; undefined gives today's camera. */
    initialFrame?: CameraFrame;
    /** The lots of `policy`'s brush queries; null while one is unresolved (PolicySync). */
    lots: Lots | null;
    /**
     * PolicySync settled with a failure: a brush query `policy` needs failed, so `lots` stays null
     * until it is asked again. The unsent edit is dropped and the notice offers Retry.
     */
    lotsFailed?: boolean;
    /** The brush-failure notice's Retry: ask the failed queries again. */
    onlotsretry?(): void;
    readonly: boolean;
    onedit(change: (p: SimPolicy4) => SimPolicy4, label: string): void;
    /** Rule 34: undo to the last document the worker accepted (the store's `undoTo`). */
    onundoto(p: SimPolicy4): void;
    selected: SpanRef | null;
    onselect(ref: SpanRef | null): void;
    /** The timeline's "+" (the menu is the page's). */
    onadd(kind: PolicyKind): void;
    /** The page's inspector, given the Activity and Details faces and the playhead's day. */
    inspector?: Snippet<[{ activity: Snippet; details: Snippet; day: Day }]>;
    /**
     * The inspector is open (default true). Below md it is a sheet that shows only while open;
     * from md the detail column beside the timeline always shows: the inspector while open,
     * else Activity.
     */
    inspectorOpen?: boolean;
    /**
     * What the detail column shows (Activity, Details, an editor, a menu): a new key starts it at
     * its top.
     */
    detailKey?: string;
    /** The playhead's day, on every change. */
    onday?(day: Day): void;
    /** The client's requests on each open (mount, Retry, restart); null on a crash and unmount. */
    onclient?(api: TimelineClientApi | null): void;
    onmapready?(h: SimMapHandle, map: MapLike): void;
    /** The manifest SimMap renders, at mount and whenever a Retry replaces it. */
    onmanifest?(m: Manifest | null): void;
    /** A Retry's reload brought a new calibration. */
    oncalibration?(cal: Calibration): void;
    /**
     * Whether the run carries car data (the worker loaded cars.bin: `Loaded.cars`), on each change
     * once the session has a view.
     */
    oncars?(on: boolean): void;
    /** The zoning in force at the last view month: height regions and contours. */
    onheights?(c: HeightCity): void;
    /** A chunk response arrived (lots may have loaded). */
    onchunks?(): void;
    /** A map tap that opened no card (the page selects by lot, rule 19). */
    onmiss?(): void;
    /** The header score is pressed. */
    onscore?(): void;
    /**
     * Activity's starter is pressed: the page adds `choice` as its "+" menu does, announcing
     * "Added: {label}". Absent (read-only), Activity offers no starters.
     */
    onstarter?(choice: AddChoice, label: string): void;
    /**
     * Why the last starter added nothing (a funding limit's words): a card in Activity at today.
     * Leaving today calls `ondismissrefusal`, so it is gone when the person comes back.
     */
    refusal?: string | null;
    /** The refusal's Dismiss, or the playhead left today. */
    ondismissrefusal?(): void;
    /** Activity's Details button. Absent, it presses the header score. */
    ondetails?(): void;
    /** Details' Activity button; absent, Details has none. */
    onactivity?(): void;
    /** The sheet shows Details: the header score's `aria-expanded`, below md only. */
    scoreExpanded?: boolean;
    /** The detail column's id: the header score's `aria-controls` while the column shows. */
    scoreControls?: string;
    /** Px added to the map's bottom inset (a phone sheet over it). Default 0. */
    bottomExtra?: number;
    /** Test seam: the status slot's least gap between updates (rule 32). */
    statusMs?: number;
    /**
     * Test seam: the goal every goal read goes through without a game (in a game it is not read:
     * the goal is the rung in play's). Default `defaultGoal(asOf)`.
     */
    goal?: Goal;
    /** Test seam: fetches the neighbourhoods Activity's list names; null on any failure. */
    fetchPlaces?(url: string): Promise<NeighborhoodShapes | null>;
    /**
     * Space plays and pauses (default true). The page turns it off while a paint tool is chosen,
     * where Space is the brush's temporary Move.
     */
    spacePlays?: boolean;
  }

  let {
    manifest: initialManifest,
    manifestError,
    calibration: initialCalibration,
    calibrationError,
    noScenario,
    datasetVersion,
    reload,
    createWorker = spawnSimWorker,
    view = HIDDEN_VIEW,
    cards = true,
    ownerName = undefined,
    fundingName = undefined,
    actions = undefined,
    layers = undefined,
    status = undefined,
    saveOff = false,
    notices = undefined,
    policy,
    run = undefined,
    game = null,
    goalAmount = null,
    initialFrame = undefined,
    lots,
    lotsFailed = false,
    onlotsretry = undefined,
    readonly,
    onedit,
    onundoto,
    selected,
    onselect,
    onadd,
    inspector = undefined,
    inspectorOpen = true,
    detailKey = '',
    onday = undefined,
    onclient = undefined,
    onmapready = undefined,
    onmanifest = undefined,
    oncalibration = undefined,
    oncars = undefined,
    onheights = undefined,
    onchunks = undefined,
    onmiss = undefined,
    onscore = undefined,
    onstarter = undefined,
    refusal = null,
    ondismissrefusal = undefined,
    ondetails = undefined,
    onactivity = undefined,
    scoreExpanded = false,
    scoreControls = undefined,
    bottomExtra = 0,
    goal: goalSeam = undefined,
    statusMs = 1000,
    fetchPlaces = (url: string) => loadPlaces(url),
    spacePlays = true
  }: Props = $props();

  // The props seed the page once; a Retry replaces the manifest and calibration in place.
  let manifest = $state.raw<Manifest | null>(untrack(() => initialManifest));
  untrack(() => onmanifest?.(manifest));
  let calibration = $state.raw<Calibration | null>(untrack(() => initialCalibration));
  /** The data before the worker is missing (rule 30): Retry reloads it. */
  let failed = $state(
    untrack(
      () =>
        !noScenario &&
        (manifestError || calibrationError || !initialManifest || !initialCalibration)
    )
  );
  let retrying = false;
  let mounted = $state(false);
  let session = $state.raw<TimelineSession | null>(null);
  let client: TimelineClient | null = null;
  let clientApi: TimelineClientApi | null = null;
  let handle: SimMapHandle | null = null;
  let map: MapLike | null = null;
  let dead = false;

  let day = $state<Day>(untrack(() => initialCalibration?.asOf ?? 0));
  let playing = $state(false);
  let speed = $state<Speed>(DEFAULT_SPEED);
  /** How far the playhead has been (rule 3): everything ahead of `reached` is unseen. */
  let reveal = $state.raw<Reveal>(revealOpen(untrack(() => initialCalibration?.asOf ?? 0)));
  /** Every refill's `from`, in arrival order (the e2e hook). */
  const refills: number[] = [];

  // Until SimMap's handle exists, cells and chunk statuses wait here, in order.
  let pendingUpdates: TimelineUpdate[] = [];
  const pendingStatus = new Map<string, ChunkStatus>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  const statusCells = new Set<string>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  let pushedLookups: MapLookups | null = null;
  /** The worker's latest posted permitting tables (rule 20); null before the first. */
  let leverLookups: LeverLookups | null = null;

  const asOf = $derived(calibration?.asOf ?? 0);
  const windowEnd = $derived(monthLastDay(asOf, WINDOW_MONTHS));
  /** The game in play; the open game is no game (G2). */
  const g = $derived(game && !game.open ? game : null);
  /**
   * The page's goal. In a game, the rung in play's (`goalAmount` its amount when given; the seam
   * is not read). Without one, the seam, else the default goal built from the dataset's date,
   * with `goalAmount` as its amount when given.
   */
  const goal = $derived(
    g
      ? goalAt(asOf, g.state.rung, goalAmount ?? undefined)
      : (goalSeam ??
          (goalAmount !== null ? { ...defaultGoal(asOf), amount: goalAmount } : defaultGoal(asOf)))
  );
  /** The document the worker runs: `run`, else the one on show. */
  const runDoc = $derived(run ?? policy);
  const current = $derived(session?.view ?? null);
  const statics = $derived(session?.statics ?? null);
  const months = $derived(statics?.months ?? current?.months ?? null);
  /** The playhead's calendar month. */
  const index = $derived(months ? playheadAt(months, asOf, day).index : 0);
  /** The last day the playhead may reach: the last calendar month row's last day. */
  const lastDay = $derived(months ? filledEndDay(months, months.length - 1, asOf) : windowEnd);
  const shown = $derived(session ? session.shown(index) : { view: null, stale: false });
  /** The numbers on show are from before the latest change (rule 31). */
  const stale = $derived(shown.stale);
  /**
   * The computed edge: the playhead waits there (rule 24). Filled to the last month, it is
   * `lastDay`, the last calendar month row's last day, so End, Replay and the end of playback
   * reach it and every reading names that row's month.
   */
  const filledEnd = $derived(
    !current
      ? asOf
      : current.filledThrough >= current.lastIndex
        ? lastDay
        : Math.min(filledEndDay(current.months, current.filledThrough, asOf), windowEnd)
  );
  const tierBaseline = $derived(statics?.tierBaseline ?? null);
  /**
   * The view on show, stable across months: `shown` is a new object for every month, its view is
   * not, so what derives from this rebuilds only when the view changes.
   */
  const shownView = $derived(shown.view);
  /** Today's score shape over the view on show (rule 26). */
  const score = $derived(shownView ? scoreOfView(shownView, tierBaseline) : null);
  const shownFilled = $derived(shown.view?.filledThrough ?? -1);
  /** The run carries car data; null until the session has a view. */
  const runCars = $derived(current ? current.cars !== null : null);
  $effect(() => {
    const on = runCars;
    if (on !== null) untrack(() => oncars?.(on));
  });
  /**
   * The cars layer's values: cars per household by zone at the playhead's month (null past the
   * fill). The same array for the same month, so the map rebuilds its source only when the month
   * changes. Undefined unless the run carries car data: the map keeps the layer off, fetching
   * nothing.
   */
  const carZones = $derived(
    runCars !== true
      ? undefined
      : shownView?.cars && index <= shownFilled
        ? (shownView.cars.zones[index] ?? null)
        : null
  );
  /** `resultsAt` over the score above (the view's, built once); at today `todayAt` of it. */
  const at = $derived.by(() => {
    if (!shown.view || !score || index > shownFilled) return null;
    const read = resultsAt(shown.view, tierBaseline, index, score);
    return atToday ? todayAt(read) : read;
  });
  /**
   * The document the shown numbers are from: the one the worker runs, or while stale the one it
   * ran when the held view was taken; the edited run document until the session has one.
   */
  let heldDoc = $state.raw<SimPolicy4 | null>(null);
  const resultsDoc = $derived((stale ? heldDoc : null) ?? session?.accepted ?? runDoc);
  /** A policy of the person's is in force in the document the numbers on show are from. */
  const inForce = $derived(!nothingInForce(resultsDoc));
  /**
   * The key's mark row shows while the map can show marks of the edited document: a policy in
   * force in the numbers on show, or, while they are stale, in the edited one.
   */
  const keyMarks = $derived(inForce || (stale && !nothingInForce(runDoc)));
  /**
   * The pool levels the Public money bars draw: from the view on show and the document and
   * calibration it was run on, rebuilt with them, never as the playhead moves.
   */
  const levels = $derived(
    levelSet(shownView, resultsDoc, calibration?.baselineFunding?.pools, asOf)
  );
  /**
   * The comparison's wording for Details and the header, from the document the numbers on show
   * are from, so it changes with the numbers (held numbers keep theirs).
   */
  const copy = $derived(copyOf(!inForce));
  /** The playhead is at the dataset date: the headline reads today. */
  const atToday = $derived(playheadAt(months ?? [], asOf, day).atToday);
  // A starter's refusal belongs to today: leaving today clears it.
  $effect(() => {
    if (!atToday && refusal !== null) untrack(() => ondismissrefusal?.());
  });
  /**
   * The headline at the playhead's month (rule 27; OQ-3: "calculating" while provisional). It
   * reads `index` and `atToday`, never `day`, so it changes at most once per month the playhead
   * crosses. The playhead stops at the last row's month, so `months[index]` is the readout's.
   */
  const headline = $derived(
    headlineAt(
      shown.view,
      { index, atToday },
      { provisional: session?.provisional ?? false, inForce },
      goal
    )
  );
  const headText = $derived(headline ? headlineText(headline, goal) : null);
  /**
   * The map key's counts (its `tally`): the homes in each stage at the playhead's month, under the
   * headline's rules. It reads `index` and `atToday`, never `day`, so it reads one row at most once
   * per month the playhead crosses.
   */
  const keyCounts = $derived(
    keyTally(
      shown.view,
      { index, atToday },
      { provisional: session?.provisional ?? false, inForce }
    )
  );
  /**
   * Activity's totals at the playhead's month, under the headline's rule and from the document the
   * numbers on show came from (held while stale). It reads `index` and `atToday`, never `day`, so
   * it changes at most once per month the playhead crosses.
   */
  const totals = $derived(
    activityTotals(
      shown.view,
      { index, atToday },
      {
        provisional: session?.provisional ?? false,
        inForce,
        moneyInForce: moneyInForce(resultsDoc)
      }
    )
  );
  /**
   * Activity's list: the page's own copy of the citywide feed (map-interfaces, "The citywide
   * feed"), indexed by day. `cityVersion` moves once per update that carries markers.
   */
  const activityIndex = new ActivityIndex();
  let cityVersion = $state(0);
  /** The list on show; a new array only when an item differs (the DOM is kept otherwise). */
  let latestShown: ActivityEvent[] = [];
  const sameEvent = (a: ActivityEvent, b: ActivityEvent) =>
    a.row === b.row &&
    a.kind === b.kind &&
    a.day === b.day &&
    a.homes === b.homes &&
    a.policy === b.policy &&
    a.lngLat[0] === b.lngLat[0] &&
    a.lngLat[1] === b.lngLat[1];
  /**
   * The newest stage changes after today and at or before the playhead's day. Per move a binary
   * search and at most ACTIVITY_LIMIT events (the index sorts only after an update).
   */
  const latest = $derived.by(() => {
    void cityVersion;
    const next = activityIndex.recent(asOf, day, ACTIVITY_LIMIT);
    const prev = latestShown;
    if (next.length === prev.length && next.every((e, i) => sameEvent(e, prev[i]))) return prev;
    latestShown = next;
    return next;
  });
  /** The neighbourhoods, once per manifest, fetched when the list first has an item. */
  let places = $state.raw<NeighborhoodShapes | null>(null);
  let placesFor: Manifest | null = null;
  const wantPlaces = $derived(latest.length > 0);
  $effect(() => {
    if (!wantPlaces || !manifest || placesFor === manifest) return;
    const m = manifest;
    placesFor = m;
    places = null;
    const url = datasetUrl(m, m.neighborhoods);
    if (url === null) return;
    void fetchPlaces(url).then((s) => {
      if (!dead && placesFor === m) places = s;
    });
  });
  /** Names by row, until the index or the shapes change. */
  let placeMemo = new Map<number, string | null>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  let placeMemoKey: [number, NeighborhoodShapes | null] = [-1, null];
  function placeFor(e: ActivityEvent, shapes: NeighborhoodShapes | null, v: number): string | null {
    if (!shapes) return null;
    if (placeMemoKey[0] !== v || placeMemoKey[1] !== shapes) {
      placeMemo = new Map();
      placeMemoKey = [v, shapes];
    }
    let name = placeMemo.get(e.row);
    if (name === undefined) placeMemo.set(e.row, (name = placeOf(shapes, e.lngLat)));
    return name;
  }
  const latestItems = $derived<ActivityItem[]>(
    latest.map((e) => ({
      key: `${e.row}:${e.kind}`,
      policy: e.policy,
      ...eventText(
        e,
        placeFor(
          e,
          places,
          untrack(() => cityVersion)
        )
      )
    }))
  );
  /**
   * At today with nothing in force in the edited run document and the page editable: the starters.
   * None in a game, even given `onstarter` (game-sim #tbl-replacements).
   */
  const starters = $derived(
    !g && onstarter && calibration && nothingInForce(runDoc) ? startersFor(calibration, runDoc) : []
  );
  /** The map key control's box: the card's area ends at its left edge. */
  let keyEl = $state<HTMLElement>();
  /**
   * The goal's step, an input: from the newest view, else the one on show (a restart's re-open
   * keeps held numbers with no view of its own), so it stays whole while numbers show.
   */
  const stepView = $derived(current ?? shownView);
  const chartTarget = $derived(stepView ? goalStep(goal, stepView) : null);
  /** The ruler's goal flag: at the deadline while the chart draws the goal's step. */
  const goalDeadline = $derived(chartTarget ? goal.deadline : null);
  /**
   * The month of the furthest date reached (TODAY at or before the dataset date), a primitive: the
   * goal notice reads this and never the day, so it changes at most once per month reached.
   */
  const reachedMonth = $derived(
    months && reveal.reached > asOf ? indexOfDay(months, reveal.reached) : TODAY
  );
  /** An edit's first changed month is being looked for: the outcome waits for it. */
  const searching = $derived(reveal.finding !== null);
  /**
   * What the months reached say of the goal. Held while the numbers are stale or a search is under
   * way, so an edit's answer replaces it once, never on the way. Compared by key: an unchanged
   * outcome keeps its object, so nothing downstream rewrites.
   */
  let outcome = $state.raw<GoalOutcome | null>(null);
  /**
   * Whether a policy is in force in the document `outcome` came from, held with it under the same
   * wait, so the notice's wording and numbers are always one document's.
   */
  let outcomeInForce = $state(false);
  $effect(() => {
    const view = shown.view;
    const m = reachedMonth;
    const gl = goal;
    const f = inForce;
    const wait = stale || searching;
    untrack(() => {
      if (wait) return;
      // The window's last month stands for the window's last day, which is where a goal due at
      // the window's end is judged.
      const day =
        m === TODAY || !view
          ? asOf
          : m >= view.lastIndex
            ? filledEndDay(view.months, view.lastIndex, asOf)
            : view.months[m];
      // A view not yet covering the months read is no answer: the last outcome stays.
      if (awaitsView(gl, view, day, asOf)) return;
      const next = goalOutcome(gl, view, day, asOf);
      const same =
        next === outcome ||
        (next !== null && outcome !== null && outcomeKey(next) === outcomeKey(outcome));
      if (!same) outcome = next;
      outcomeInForce = f;
    });
  });
  /** Outcomes dismissed this visit, by key. */
  const dismissed = new SvelteSet<string>();

  /**
   * Dismissing removes the focused button: focus goes to the next notice's button in the stack,
   * else to the ruler, so it never drops to the page.
   */
  async function dismissGoal(e: MouseEvent) {
    if (!outcome) return;
    const buttons = [...(pillsEl?.querySelectorAll('button') ?? [])];
    const next = buttons[buttons.indexOf(e.currentTarget as HTMLButtonElement) + 1];
    dismissed.add(outcomeKey(outcome));
    await tick();
    const target = next?.isConnected ? next : rulerEl();
    target?.focus();
  }
  function rulerEl(): HTMLElement | null {
    return (modeEl ?? document).querySelector<HTMLElement>('[data-testid=tl-ruler]');
  }
  /** Today's goal notice; none in a game (game-sim #sec-design-goal). */
  const goalNotice = $derived.by(() => {
    const o = outcome;
    if (g || !o || dismissed.has(outcomeKey(o))) return null;
    return outcomeText(o, goal, outcomeInForce);
  });

  // ---- the game's goal headline (game-sim #sec-design-goal, #tbl-goal-props) ----

  type SideEntry = { goal: SideGoal; value: number; target: number; met: boolean };
  /**
   * GoalHeadline's props in a game; null without a game. The homes are the view on show's at the
   * playhead's month (null with no view or that month not filled). The side goals are read on the
   * view on show at the deadline's month, with the last run's take when it was on the rung in
   * play; none with no view or that month not filled.
   */
  const goalProps = $derived.by(() => {
    if (!g) return null;
    const s = g.state;
    const rung = s.rung;
    const last = s.last !== null && s.last.rung === rung ? s.last : null;
    const sideTake = last
      ? { dropped: last.dropped, collected: last.collected }
      : { dropped: {}, collected: {} };
    const view = shownView;
    const side: SideEntry[] = [];
    if (view) {
      const i = indexOfDay(view.months, goal.deadline);
      if (i <= view.filledThrough) {
        for (const sg of sideShown(s)) {
          const r = sg.read({ view, index: i, take: sideTake, inForce });
          if (r !== null) side.push({ goal: sg, ...r, met: r.value >= r.target });
        }
      }
    }
    const i = atToday ? TODAY : index;
    const homes = view && i <= view.filledThrough ? goal.measure.valueAt(view, i) : null;
    return {
      homes,
      amount: goal.amount,
      deadline: ladder(asOf)[rung].label,
      unlocks:
        rung + 1 < RUNGS
          ? goalUnlocks(NODES.filter((n) => n.ring === rung + 1).length, true)
          : null,
      met: s.met.some((e) => e.rung === rung),
      side
    };
  });
  // The held document goes once the numbers on show are current again.
  $effect(() => {
    if (!stale) untrack(() => (heldDoc = null));
  });
  /** The market terms in force at the playhead, for Details' lost-grants line. */
  const terms = $derived(resolveTerms(MARKET_TERMS, termsInForce(resultsDoc, day)));
  const phase = $derived<FzpPhase>(
    noScenario ? 'no-scenario' : failed ? 'failed' : (session?.phase ?? 'loading')
  );
  const halted = $derived(
    session?.notices.some((n) => n.id === 'error' || n.id === 'crash') ?? false
  );

  // ---- the status slot (rules 31, 32) ----

  /**
   * Play waits at the computed edge for the forecast: true once playback has caught the edge while
   * the forecast is short of the last day; false when it stops or the forecast is whole. It is not
   * reset as the edge moves on, so it does not flicker with each fill.
   */
  let playWaits = $state(false);
  $effect(() => {
    if (!playing || filledEnd >= lastDay) playWaits = false;
    else if (day >= filledEnd) playWaits = true;
  });
  /**
   * What the status cell says: stale wins over waiting; both show "Updating". A worker error or
   * crash stops the forecast, so Play no longer waits for it: its notice says what happened.
   */
  type Shown = 'stale' | 'waiting' | null;
  const statusWanted = $derived<Shown>(
    !session ? null : stale ? 'stale' : playWaits && !halted ? 'waiting' : null
  );
  /** The cell follows the conditions at once (in step with the dimming). */
  let shownStatus = $state<Shown>(null);
  /** The live region's text: at most one change per `statusMs`, the latest wins. */
  let statusText = $state('');
  /** "Updating" covers the page's save state in the slot's one cell (not while autosave is off). */
  const covered = $derived(!saveOff && shownStatus !== null);
  let statusAt = -Infinity;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  /** At most one change a second: a change inside the gap goes out when it ends (latest wins). */
  function announce(want: string): void {
    if (statusTimer !== null) clearTimeout(statusTimer);
    statusTimer = null;
    if (want === statusText) return;
    const wait = statusAt + statusMs - performance.now();
    if (wait <= 0) {
      speak(want);
      return;
    }
    statusTimer = setTimeout(() => {
      statusTimer = null;
      speak(want);
    }, wait);
  }
  function speak(want: string): void {
    statusText = want;
    statusAt = performance.now();
  }
  /** The save state's part of the slot's cell and the shown "Updating" (bound in the snippet). */
  let saveCell = $state<HTMLElement>();
  let shownCell = $state<HTMLElement>();
  /**
   * Shows `want` in the cell. Focus inside the part about to be covered or removed is not dropped
   * to the body (WCAG 2.4.3): the save state's focused control hands it to "Updating"'s
   * explanation, in the same place; that explanation hands it back to the save state's control if
   * one shows, else to the header score. With autosave off nothing is covered.
   */
  function setStatus(want: Shown): void {
    if (want === shownStatus) return;
    const active = document.activeElement;
    const covering = want !== null && !saveOff && !!saveCell?.contains(active);
    const uncovering = want === null && !!shownCell?.contains(active);
    shownStatus = want;
    if (!covering && !uncovering) return;
    void tick().then(() => {
      if (covering) {
        shownCell?.querySelector<HTMLElement>('button')?.focus();
        return;
      }
      const back = saveCell?.querySelector<HTMLElement>('button, a[href]');
      if (back?.checkVisibility()) back.focus();
      else if (!document.activeElement || document.activeElement === document.body)
        saveCell?.closest('header')?.querySelector<HTMLElement>('[data-testid=score-bar]')?.focus();
    });
  }
  $effect(() => {
    const want = statusWanted;
    untrack(() => {
      setStatus(want);
      announce(want === null ? '' : UPDATING);
    });
  });

  // ---- the card and tooltip ----

  let cardState = $state.raw<SummaryState>({ kind: 'idle' });
  let cardTap = $state.raw<{
    x: number;
    y: number;
    lngLat: [number, number] | null;
    parcelId: ParcelId;
  } | null>(null);
  let cardSize = $state.raw<{ w: number; h: number } | null>(null);
  let cardBounds = $state.raw<CardArea | null>(null);
  let mapBox = $state<HTMLElement>();
  let pillsEl = $state<HTMLElement>();
  let tipState = $state.raw<SummaryState>({ kind: 'idle' });
  let tipAt = $state({ x: 0, y: 0 });
  let about = $state<ReturnType<typeof AboutDialog>>();
  let playhead = $state<ReturnType<typeof Playhead>>();

  /**
   * Space presses Play (or Pause) as the button does, "Play from" included: not on a repeat, with
   * a modifier, in a field, on a control Space presses, under a modal dialog or an open popover,
   * or once something else handled the key (`isPlayKey`). Handled here, so the page never scrolls.
   */
  function overlayOpen(): boolean {
    try {
      return document.querySelector('dialog:modal, :popover-open') !== null;
    } catch {
      // A browser without :popover-open throws on the whole list.
      return document.querySelector('dialog[open]') !== null;
    }
  }

  /**
   * A Space press that toggled is held: its repeats are handled too, without a toggle, so a held
   * key never scrolls the page. Cleared on Space's keyup and on a window blur.
   */
  let spaceTook = false;

  function onWindowKey(e: KeyboardEvent): void {
    if (spaceTook && e.key === ' ' && e.repeat) return e.preventDefault();
    if (!spacePlays || !playhead) return;
    if (!isPlayKey(e, overlayOpen())) return;
    e.preventDefault();
    spaceTook = true;
    playhead.toggle();
  }

  function onWindowKeyUp(e: KeyboardEvent): void {
    if (e.key === ' ') spaceTook = false;
  }
  /** About's live assumptions: read only once the dialog has opened (props are lazy). */
  const aboutSections = $derived(calibration ? provenanceSections(calibration, score, terms) : []);
  /** The month the open card was last asked for. */
  let cardMonth: Day | null = null;
  /** The stage tables each card's own answer carried (rule 20). */
  const cardLookups = new WeakMap<ProjectCard, Lookups>();

  const summaryDeps = {
    send: (q: { parcelId: string; day: Day; projectId?: string }) =>
      client
        ? client.parcelSummary(q.parcelId, q.day, q.projectId).then((s) => {
            if (s?.project && s.lookups) cardLookups.set(s.project, s.lookups);
            return s;
          })
        : Promise.resolve(null),
    // A crash or an error that stopped the fill: "Details unavailable" (rule 35).
    unavailable: () => (client?.crashed ?? false) || (session?.stoppedByError ?? false)
  };
  const cardReq = new SummaryRequester({ ...summaryDeps, onstate: (s) => (cardState = s) });
  const tipReq = new SummaryRequester({ ...summaryDeps, onstate: (s) => (tipState = s) });

  const cardOpen = $derived(cardState.kind !== 'idle');
  /** The card's chance tables: its answer's, else the worker's posted ones, else the base. */
  const cardChance = $derived.by(() => {
    const own = cardState.kind === 'project' ? cardLookups.get(cardState.card) : undefined;
    if (own) return { inFlight: own.chance, fresh: own.chance };
    if (leverLookupsShown) {
      return { inFlight: leverLookupsShown.inFlight.chance, fresh: leverLookupsShown.fresh.chance };
    }
    const base = calibration ? lookupsFor(calibration) : null;
    return base && { inFlight: base.chance, fresh: base.chance };
  });
  /** `leverLookups`, reactive for the card (the map gets the plain one). */
  let leverLookupsShown = $state.raw<LeverLookups | null>(null);

  /** The open card asks again for the playhead's day. */
  function refreshCard(): void {
    const q = cardReq.query;
    if (!q || cardState.kind === 'idle') return;
    cardMonth = monthStart(day);
    cardReq.request({ ...q, day });
    session?.watchCard(day);
  }

  function closeCard(): void {
    cardReq.reset();
    cardMonth = null;
    cardTap = null;
    session?.watchCard(null);
  }

  function hideTooltip(): void {
    tipReq.reset();
  }

  function measureCardArea(): void {
    if (!mapBox) return;
    const m = mapBox.getBoundingClientRect();
    const zoom = mapBox.querySelector('.maplibregl-ctrl-bottom-left')?.getBoundingClientRect();
    const br = parseFloat(document.documentElement.style.getPropertyValue(BR_BLOCK)) || 0;
    // The key control (hidden below md while a card is open: no box, no edge).
    const key = keyEl?.getBoundingClientRect();
    const next = cardArea(
      { left: m.left, top: m.top, width: m.width, height: m.height },
      pillsEl ? pillsEl.getBoundingClientRect() : null,
      0,
      0,
      {
        left: zoom && zoom.width > 0 ? zoom.right - m.left : 0,
        bottom: br,
        right: key && key.width > 0 ? m.right - key.left : 0
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

  $effect(() => {
    if (!cardOpen || !mapBox) return;
    untrack(measureCardArea);
    return watchCardArea(
      {
        map: mapBox,
        pills: pillsEl,
        controls: mapBox.querySelector<HTMLElement>('.maplibregl-ctrl-bottom-left'),
        key: keyEl
      },
      measureCardArea
    );
  });
  $effect(() => {
    const m = mapNow;
    if (!cardOpen || !m) return;
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const tap = cardTap;
        if (!tap?.lngLat) return;
        const p = m.project(tap.lngLat);
        if (p.x !== tap.x || p.y !== tap.y) cardTap = { ...tap, x: p.x, y: p.y };
      });
    };
    m.on('move', follow);
    return () => {
      cancelAnimationFrame(frame);
      m.off('move', follow);
    };
  });
  /** `map`, reactive for the card's follow effect. */
  let mapNow = $state.raw<MapLike | null>(null);
  const cardAnchor = $derived.by(() => {
    if (!cardTap || !cardSize || !cardBounds) return null;
    const { left, top } = cardPlacement({ x: cardTap.x, y: cardTap.y }, cardSize, cardBounds);
    return { left, top, maxHeight: Math.max(0, cardBounds.bottom - cardBounds.top - 16) };
  });
  const cardAllowedBy = $derived.by(() => {
    const owner = cardState.kind === 'project' ? cardState.limits?.owner : undefined;
    return owner && cardTap && ownerName ? ownerName(owner, cardTap.parcelId) : null;
  });
  const cardFunded = $derived(
    cardState.kind === 'project' && fundingName ? cardFunding(cardState.card) : null
  );
  const cardFundedBy = $derived(cardFunded && fundingName ? fundingName(cardFunded) : null);

  // Cards turned off (a paint tool): an open card closes.
  $effect(() => {
    if (!cards) untrack(closeCard);
  });

  // Filling stopped or resumed (rule 35, a crash, a Retry): the open card asks again.
  let wasStopped = false;
  $effect(() => {
    const s = session?.stoppedByError ?? false;
    untrack(() => {
      if (s === wasStopped) return;
      wasStopped = s;
      if (s) hideTooltip();
      refreshCard();
    });
  });

  function onPick(p: TimelinePick): void {
    if (p.kind === 'tap' && !cards) return;
    if (p.projectId === null) {
      hideTooltip();
      if (p.kind === 'tap') {
        closeCard();
        onmiss?.();
      }
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
    const ll = map?.unproject([p.x, p.y]);
    cardTap = { x: p.x, y: p.y, lngLat: ll ? [ll.lng, ll.lat] : null, parcelId: p.parcelId };
    cardReq.request(q);
    session?.watchCard(day);
  }

  // ---- the map ----

  function pushLookups(): void {
    if (!handle || !calibration) return;
    const l = leverLookups ? mapLookupsFor(leverLookups) : lookupsFor(calibration);
    if (l === pushedLookups) return;
    pushedLookups = l;
    handle.setTimelineLookups(l);
  }

  function applyRender(u: TimelineUpdate): void {
    // Activity's index first, whether or not the map exists yet (the map may take the buffers).
    if (u.revision === 0 || u.city) {
      try {
        activityIndex.apply(u);
      } catch {
        // A malformed delta leaves the index as it was; the map's own store reports it.
      }
      cityVersion++;
    }
    if (handle) return handle.applyTimeline(u);
    if (u.revision === 0) pendingUpdates = [];
    pendingUpdates.push(u);
  }

  function setChunkStatus(cellId: string, s: ChunkStatus): void {
    statusCells.add(cellId);
    if (handle) return handle.setChunkStatus(cellId, s);
    pendingStatus.delete(cellId);
    pendingStatus.set(cellId, s);
  }

  /** The restarted worker reports only the cells it fetches. */
  function resetChunkStatuses(): void {
    for (const cellId of statusCells) setChunkStatus(cellId, 'ready');
    statusCells.clear();
  }

  /** Asks for the viewport's chunks. */
  function prefetchViewport(): void {
    if (!client || client.crashed || !map || !statics) return;
    const b = map.getBounds();
    client.prefetch([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  }

  function attachMap(m: MapLike | null): void {
    if (m === map) return;
    map?.off('moveend', prefetchViewport);
    map = m;
    mapNow = m;
    map?.on('moveend', prefetchViewport);
  }

  // The first `compiled` of each open: prefetch the viewport.
  $effect(() => {
    if (statics) untrack(prefetchViewport);
  });

  function applyInset(): void {
    handle?.setBottomInset(untrack(() => bottomExtra));
  }

  let lastExtra = untrack(() => bottomExtra);
  $effect(() => {
    const extra = bottomExtra;
    if (extra === lastExtra) return;
    lastExtra = extra;
    untrack(applyInset);
  });

  function onMapReady(h: SimMapHandle): void {
    if (dead) return;
    handle = h;
    pushLookups();
    const queued = pendingUpdates;
    pendingUpdates = [];
    for (const u of queued) h.applyTimeline(u);
    for (const [cellId, s] of pendingStatus) h.setChunkStatus(cellId, s);
    pendingStatus.clear();
    if (calibration) {
      h.setTime(day);
      // Policy marks from the dataset date on: none shows at today. Once, not per move.
      h.setHalos({ from: calibration.asOf });
    }
    // Bars from the default zoom, one size, the person's projects first. The page's, once.
    h.setBarMode('far');
    applyInset();
    // Rule 22.
    h.onResyncNeeded(() => session?.resync());
    attachMap(h.getMap());
    prefetchViewport();
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

  // ---- the playhead ----

  /**
   * The playhead moved (once per change): the furthest date reached, the view month, the map's
   * time, the card's month.
   */
  function handleDay(d: Day): void {
    reveal = moved(reveal, d);
    session?.playhead(d);
    handle?.setTime(d);
    if (cardMonth !== null && monthStart(d) !== cardMonth) refreshCard();
    onday?.(d);
  }

  // ---- the session ----

  /** The policy and lots the session last took (an edit is a new object). */
  let seenPolicy: SimPolicy4 | null = null;
  let seenLots: Lots | null = null;

  function startSession(): void {
    if (dead || session || !manifest || !calibration) return;
    const cal = calibration;
    const s = new TimelineSession({
      manifest,
      calibration: cal,
      undoTo: (p) => untrack(() => onundoto(p)),
      createWorker: () => createWorker(),
      createClient: (worker, events) => {
        const c = new TimelineClient(worker, {
          ...events,
          onRefill: (m) => {
            refills.push(m.from);
            events.onRefill?.(m);
          },
          onCrash: (e) => {
            events.onCrash?.(e);
            if (dead) return;
            onclient?.(null);
            hideTooltip();
          }
        });
        client = c;
        clientApi = {
          resolveBrush: (q) => c.resolveBrush(q),
          brushCatalog: () => c.brushCatalog(),
          lotOutlines: (l) => c.lotOutlines(l),
          previewBuildings: (l, stories) => c.previewBuildings(l, stories),
          heightLids: (bbox) => c.heightLids(bbox),
          lotAt: (point) => c.lotAt(point),
          retryChunks: () => c.retryChunks()
        };
        const api = clientApi;
        return {
          open: (m, p, l) => {
            const rev = c.open(m, p, l);
            if (!dead) onclient?.(api);
            return rev;
          },
          setPolicy: (p, l) => c.setPolicy(p, l),
          viewMonth: (m) => c.viewMonth(m),
          resyncMap: () => c.resyncMap(),
          retryChunks: () => c.retryChunks(),
          restart: (w) => {
            c.restart(w);
            resetChunkStatuses();
            if (!dead) onclient?.(api);
          },
          dispose: () => c.dispose()
        };
      },
      now: () => performance.now(),
      setTimeout: ((fn: () => void, ms?: number) => setTimeout(fn, ms)) as typeof setTimeout,
      clearTimeout: ((t?: ReturnType<typeof setTimeout>) => clearTimeout(t)) as typeof clearTimeout,
      oncells: (u) => {
        if (!dead) applyRender(u);
      },
      onlookups: (l) => {
        if (dead) return;
        leverLookups = l;
        leverLookupsShown = l;
        pushLookups();
      },
      onheights: (c) => {
        if (!dead) onheights?.(c);
      },
      onchunks: (c) => {
        if (dead) return;
        for (const [cellId, st] of Object.entries(c.status)) setChunkStatus(cellId, st);
        cardReq.retryIfNotLoaded(day);
        tipReq.retryIfNotLoaded(day);
        onchunks?.();
      }
    });
    s.oncardrefresh = refreshCard;
    const [p, l] = untrack(() => [runDoc, lots] as const);
    seenPolicy = p;
    seenLots = l;
    s.open(p, l);
    s.playhead(day);
    session = s;
  }

  /**
   * The document the numbers on show came from, to hold while a change is stale: taken before the
   * session changes. Already stale and held, the held one stays.
   */
  function hold(s: TimelineSession): SimPolicy4 | null {
    return !stale || heldDoc === null ? s.accepted : heldDoc;
  }

  // An edit (a new run document): the edit is marked at once and playback pauses (rule 25). The
  // reveal starts looking for the first month it changed, against the numbers on show now (a
  // search already under way keeps what was seen first).
  $effect(() => {
    const p = runDoc;
    untrack(() => {
      if (!session || p === seenPolicy) return;
      seenPolicy = p;
      const seen = shown.view ? { view: shown.view, inForce } : null;
      heldDoc = hold(session);
      session.edited();
      reveal = editedReveal(reveal, seen);
      playing = false;
    });
  });

  /**
   * An edit waits for its refill: until then the newest view is still the old one. A provisional
   * open waits until its full document has filled the window (its send is not an edit, so it is
   * never pending).
   */
  const waiting = $derived(!session || session.pending || session.provisional);
  // The scan: once the edit is answered, as the new view fills. It runs when the view or the
  // waiting state changes, never as the playhead moves; `scanned` resumes where it stopped.
  $effect(() => {
    const v = current;
    const wait = waiting;
    untrack(() => {
      if (wait || !session) return;
      const now = v ? { view: v, inForce: !nothingInForce(session.accepted ?? runDoc) } : null;
      reveal = scanned(reveal, now, { day, playing, asOf });
    });
  });
  /**
   * The day "Play from" offers: the first changed month's start, clamped into today..the computed
   * edge as the Playhead clamps it, so the hook and the control name the same day.
   */
  const playFromDay = $derived(
    reveal.playFrom === null || !months ? null : clampDay(months[reveal.playFrom], asOf, filledEnd)
  );

  // PolicySync settled with a failure: the unsent edit ends (it goes out once Retry finds its
  // lots), so the page shows the last sent document's forecast, current, with the notice.
  $effect(() => {
    void runDoc;
    const failedNow = lotsFailed && lots === null;
    untrack(() => {
      if (session && failedNow) session.dropUnsent();
    });
  });

  // The edit's lots settled (or a provisional open's): the pair goes out. A send that goes out
  // with no search under way (a Retry's lots, a provisional open's full document) can change the
  // numbers with no edit: as an edit does, it holds the document the numbers on show came from
  // and starts a search against those numbers.
  $effect(() => {
    const l = lots;
    untrack(() => {
      if (!session || l === null || l === seenLots) return;
      seenLots = l;
      const seen = reveal.finding === null && shown.view ? { view: shown.view, inForce } : null;
      const held = hold(session);
      if (!session.send(runDoc, l)) return;
      heldDoc = held;
      if (seen) reveal = editedReveal(reveal, seen);
    });
  });

  async function retryLoad(): Promise<void> {
    if (retrying || dead) return;
    retrying = true;
    try {
      const fresh = await reload();
      if (dead) return;
      if (!manifest || fresh.manifest.datasetVersion !== manifest.datasetVersion) {
        manifest = fresh.manifest;
        onmanifest?.(manifest);
      }
      if (fresh.calibration !== calibration) {
        calibration = fresh.calibration;
        day = fresh.calibration.asOf;
        reveal = revealOpen(fresh.calibration.asOf);
        pushLookups();
        handle?.setTime(day);
        handle?.setHalos({ from: fresh.calibration.asOf });
        oncalibration?.(fresh.calibration);
      }
      failed = false;
      startSession();
    } catch (e) {
      console.error('[timeline] retry failed', e);
    } finally {
      retrying = false;
    }
  }

  function retryNotice(n: SessionNotice): void {
    session?.retry(n);
  }

  // ---- the inspector (rule 1) ----

  const narrow = new MediaQuery('(max-width: 767px)');
  /** The detail column shows: always from md (Activity when nothing is open), below md while open. */
  const detailShown = $derived(
    mounted && session !== null && !!inspector && (!narrow.current || inspectorOpen)
  );
  /** Below md the detail column is a sheet under the chart. */
  const phoneSheet = $derived(detailShown && narrow.current);
  let dockEl = $state<HTMLElement>();
  let detailEl = $state<HTMLElement>();

  /** The column's content swaps (Activity, Details, an editor): it starts at the top. */
  $effect(() => {
    void inspectorOpen;
    void detailKey;
    const el = detailEl;
    if (el) el.scrollTop = 0;
  });

  /** The header score's press from md: the column at its top, focus on Details. */
  export async function showDetails(): Promise<void> {
    await tick();
    if (!detailEl) return;
    detailEl.scrollTop = 0;
    detailEl.querySelector<HTMLElement>('[data-testid=tl-details]')?.focus({ preventScroll: true });
  }
  /** Activity's or Details' button, or the header from md: the column at its top, focus on it. */
  /** Activity's box: focused by showActivity, and where the refusal's Dismiss falls back. */
  let activityBox = $state<HTMLDivElement>();
  export async function showActivity(): Promise<void> {
    await tick();
    if (!detailEl) return;
    detailEl.scrollTop = 0;
    activityBox?.focus({ preventScroll: true });
  }
  /**
   * What the one chart plots: Details switches it (bound), and it is Homes whenever Details is
   * not shown (SimDetails puts it back as it unmounts).
   */
  let lens = $state<ChartLens>('homes');
  /** The pinned block's height. */
  let pinHeight = $state(0);
  /** The timeline's box's client height: the mode box below md, the bottom pane's lanes from md. */
  let modeClientH = $state(0);
  let lanesClientH = $state(0);
  /**
   * The rows scroll in their own box under the block only while it leaves MIN_ROWS of them
   * (re-read on resize); otherwise the timeline is one piece.
   */
  const pinned = $derived(
    narrow.current
      ? !modeClientH || modeClientH - pinHeight >= MIN_ROWS
      : !lanesClientH || lanesClientH - pinHeight >= MIN_ROWS
  );
  let chartBox = $state<HTMLElement>();
  let modeEl = $state<HTMLElement>();
  let sheetTop = $state(0);
  /** Px from the viewport's bottom to the mode box's: the sheet stops at the box's end (W6b). */
  let sheetBottom = $state(0);

  function placeSheet(): void {
    if (!chartBox) return;
    const bottom = chartBox.getBoundingClientRect().bottom;
    const end = Math.min(modeEl?.getBoundingClientRect().bottom ?? Infinity, window.innerHeight);
    sheetBottom = Math.max(0, window.innerHeight - end);
    sheetTop = Math.max(0, Math.min(bottom, end - MIN_SHEET));
  }
  // Opening scrolls the timeline to the top, so the playhead and the chart are in view above the
  // sheet (as the kind sheet does); the sheet follows the chart's bottom edge.
  $effect(() => {
    if (!phoneSheet || !dockEl) return;
    dockEl.scrollIntoView({ block: 'start', behavior: 'instant' });
    untrack(placeSheet);
    window.addEventListener('resize', placeSheet);
    window.addEventListener('scroll', placeSheet, true);
    return () => {
      window.removeEventListener('resize', placeSheet);
      window.removeEventListener('scroll', placeSheet, true);
    };
  });

  useHeaderActions(headerActions, { pinned: scoreBar, status: statusSlot });

  onMount(() => {
    mounted = true;
    if (!noScenario && !failed) startSession();
    applyInset();

    const uninstall = installFzpDebug(() => ({
      phase,
      day,
      asOf,
      playing,
      speed,
      filledThrough: current?.filledThrough ?? -1,
      lastIndex: statics?.lastIndex ?? -1,
      policy,
      stale,
      reached: reveal.reached,
      playFrom: playFromDay,
      refills,
      completedNet: () =>
        current ? current.rows.slice(0, current.filledThrough + 1).map((r) => r.completedNet) : []
    }));

    return () => {
      dead = true;
      if (client) onclient?.(null);
      uninstall();
      playing = false;
      if (statusTimer !== null) clearTimeout(statusTimer);
      attachMap(null);
      session?.dispose();
      client = null;
      handle = null;
    };
  });
</script>

{#snippet headerActions()}
  {#if !noScenario}
    {@render actions?.()}
  {/if}
{/snippet}

<!-- The header's status slot (rule 32), at every width: the page's save state and "Updating"
     share one cell, and "Updating" wins while both apply. The covered save state keeps its width
     (`visibility: hidden`, and the snippet's `covered` makes its own controls inert), so the cell
     is as wide as the widest and nothing moves as either comes or goes. With autosave off
     (`saveOff`) "Updating" sits beside the save state in a second cell instead, so "Autosave off"
     stays visible and pressable; that cell's sizer keeps its width while "Updating" is away. The
     save state's own live region opts back into visibility, so its announcements still reach
     screen readers. The timeline's live region is apart, once, in the page; "Updating"'s
     explanation (why the numbers are stale, or that Play waits for the months ahead) opens as a
     popover under the slot (`explain-under`, layout.css), so the header keeps its size. -->
{#snippet statusSlot()}
  <span class={['inline-grid items-center', saveOff && 'gap-x-2']} data-testid="tl-status-group">
    <span
      bind:this={saveCell}
      class={['col-start-1 row-start-1 inline-flex items-center', covered && 'invisible']}
      >{@render status?.(covered)}</span
    >
    {#if !noScenario}
      <!-- Over the save state in its cell, or beside it with autosave off: it takes presses only
           while "Updating" shows. -->
      <span
        class={[
          'tl-status explain-under relative row-start-1 inline-grid text-sm text-ink-muted tabular-nums dark:text-ink-dark-muted',
          saveOff ? 'col-start-2' : 'col-start-1',
          shownStatus === null && 'pointer-events-none'
        ]}
        data-testid="tl-status"
      >
        <span aria-hidden="true" class="invisible col-start-1 row-start-1 whitespace-nowrap"
          >{UPDATING}</span
        >
        <span
          bind:this={shownCell}
          class="col-start-1 row-start-1 whitespace-nowrap"
          data-testid="tl-status-shown"
        >
          {#if shownStatus !== null}
            <Explain text={shownStatus === 'stale' ? STALE_NOTE : WAITING_NOTE}>{UPDATING}</Explain>
          {/if}
        </span>
      </span>
    {/if}
  </span>
{/snippet}

<!-- In a game the pinned item is GoalHeadline, its two root nodes straight in the header's pinned
     box (no wrapper), once the calibration is known. -->
{#snippet scoreBar()}
  {#if goalProps && calibration}
    <GoalHeadline {...goalProps} />
  {:else if !g && session && calibration}
    <TimelineHeaderScore
      text={headText}
      busy={stale}
      {stale}
      expanded={narrow.current ? scoreExpanded : undefined}
      controls={detailShown ? (scoreControls ?? '') : ''}
      onclick={() => onscore?.()}
      live={headText ? headlineSpoken(headText) : ''}
      quiet={playing}
    />
  {/if}
{/snippet}

{#snippet details()}
  <!-- Focused by showDetails: the ring draws inside the box, which sits flush in the column's
       scroll box and would clip an outer one (WCAG 2.4.7). -->
  <div
    class="tl-dim p-3 focus:outline-2 focus:-outline-offset-2 focus:outline-accent dark:focus:outline-accent-dark"
    data-testid="tl-details"
    data-stale={stale ? 'true' : undefined}
    tabindex="-1"
  >
    <SimDetails
      {score}
      {at}
      view={score ? shownView : null}
      playhead={{ index, atToday }}
      {reachedMonth}
      {asOf}
      {copy}
      capacity={session?.capacity ?? null}
      pending={stale}
      {terms}
      {inForce}
      {goal}
      {onactivity}
      bind:lens
    />
  </div>
{/snippet}

{#snippet activity()}
  <!-- Focused by showActivity, the ring inside the box as Details'. Not dimmed as a whole: only
       Activity's body dims while stale, its heading and button keep their contrast. -->
  <div
    class="p-3 focus:outline-2 focus:-outline-offset-2 focus:outline-accent dark:focus:outline-accent-dark"
    data-testid="tl-activity"
    tabindex="-1"
    bind:this={activityBox}
  >
    <SimActivity
      {goal}
      {totals}
      {atToday}
      {starters}
      onstarter={(s) => onstarter?.(s.choice, s.label)}
      {refusal}
      {ondismissrefusal}
      fallbackfocus={() => activityBox}
      ondetails={() => (ondetails ?? onscore)?.()}
      {stale}
      events={latestItems}
    />
  </div>
{/snippet}

<svelte:window onkeydown={onWindowKey} onkeyup={onWindowKeyUp} onblur={() => (spaceTook = false)} />

{#snippet playheadPart()}
  <Playhead
    bind:this={playhead}
    {asOf}
    {windowEnd}
    last={lastDay}
    end={filledEnd}
    bind:day
    bind:playing
    bind:speed
    reached={reveal.reached}
    playFrom={playFromDay}
    {goalDeadline}
    onday={handleDay}
  />
{/snippet}

{#snippet chartPart()}
  <div bind:this={chartBox}>
    <!-- The view on show, as the header: the held numbers, dimmed, while stale. -->
    <ChartRow
      {asOf}
      {windowEnd}
      view={shown.view}
      {inForce}
      {day}
      reached={reveal.reached}
      target={chartTarget}
      {stale}
      {lens}
    />
  </div>
{/snippet}

<!-- Below md the page scrolls: the map keeps a fixed share and the timeline follows in flow, so a
     kind's sheet can scroll the playhead and the chart to the top above it (rule 9). -->
<div
  bind:this={modeEl}
  class="sfh-fzp sfh-tl relative flex h-full flex-col max-md:overflow-y-auto"
  bind:clientHeight={modeClientH}
  data-testid="tl-mode"
>
  {#if !noScenario}
    <!-- The status's one live region, at every width (polite, at most one change a second). -->
    <span role="status" class="sr-only" data-testid="tl-status-live">{statusText}</span>
  {/if}
  <!-- The notice stack's host (its parent): from md the stack overlays the map's top, under the
       header. Below md the stack is in flow and this box is no box. -->
  <div class="relative flex min-h-0 flex-1 flex-col max-md:contents">
    <!-- Every notice is a chip or a card (Message) in this one stack. -->
    <NoticePills bind:el={pillsEl}>
      {#if noScenario}
        <div role="status" class="contents">
          <Message
            text="The simulation isn't available for dataset {datasetVersion}. It needs data this dataset doesn't have."
            testid="fzp-status"
          />
        </div>
      {:else if failed}
        {#snippet retryLoadButton()}
          <button type="button" class="shrink-0 {BUTTON_QUIET}" onclick={() => void retryLoad()}
            >Retry</button
          >
        {/snippet}
        <Message
          text="The simulation couldn't load."
          actions={retryLoadButton}
          textRole="alert"
          textTestid="fzp-status"
        />
      {:else}
        {#if session}
          {@render notices?.()}
          <!-- The goal notice's polite region, mounted empty with the session so the first notice
               is announced. -->
          <div role="status" data-testid="tl-goal" class="contents">
            {#if goalNotice !== null}
              <Message text={goalNotice} ondismiss={dismissGoal} testid="tl-goal-notice" />
            {/if}
          </div>
        {/if}
        {#if phase === 'loading' && !halted}
          <div role="status" class="contents">
            <Message text="Loading the simulation…" testid="fzp-status" />
          </div>
        {/if}
        {#if session}
          <div role="status" data-testid="tl-notices" class="contents">
            {#each session.notices as n (n.id)}
              {#snippet retryButton()}
                <button type="button" class={BUTTON_QUIET} onclick={() => retryNotice(n)}
                  >Retry</button
                >
              {/snippet}
              {#if n.id === 'failed-cells'}
                <Message text="Some map data didn't load." actions={retryButton} />
              {:else if n.id === 'crash'}
                <!-- Rule 35's wording: before the first fill nothing had run to stop. -->
                <Message
                  text={session.phase === 'ready'
                    ? 'Part of the simulation stopped.'
                    : "The simulation couldn't load."}
                  actions={retryButton}
                />
              {/if}
            {/each}
          </div>
          <div role="alert" data-testid="tl-alerts" class="contents">
            {#each session.notices as n (n.id)}
              {#snippet retryButton()}
                <button type="button" class={BUTTON_QUIET} onclick={() => retryNotice(n)}
                  >Retry</button
                >
              {/snippet}
              {#if n.id === 'error'}
                <Message text={n.text} actions={retryButton} />
              {:else if n.id === 'not-applied'}
                <Message
                  text={CHANGE_NOT_APPLIED}
                  ondismiss={() => session?.dismiss('not-applied')}
                />
              {/if}
            {/each}
            {#if lotsFailed && lots === null}
              {#snippet lotsRetry()}
                <button type="button" class={BUTTON_QUIET} onclick={() => onlotsretry?.()}
                  >Retry</button
                >
              {/snippet}
              <Message text={LOTS_FAILED} actions={lotsRetry} testid="tl-lots-failed" />
            {/if}
          </div>
        {/if}
      {/if}
    </NoticePills>

    <div class="relative flex min-h-0 flex-1 max-md:h-[40%] max-md:flex-none">
      <!-- The map and everything positioned over it. -->
      <div bind:this={mapBox} class="relative min-h-0 min-w-0 flex-1" data-testid="tl-map-box">
        <div class="tl-map h-full" data-testid="tl-map" data-stale={stale ? 'true' : undefined}>
          {#if manifest}
            <SimMap
              {manifest}
              {requestParcelSummary}
              onRetryChunks={() => client?.retryChunks()}
              onready={onMapReady}
              {view}
              {carZones}
              timelinePick={onPick}
              tapCards={cards}
              {initialFrame}
            />
          {:else}
            <div class="h-full" data-testid="fzp-frame"></div>
          {/if}
        </div>

        {#if manifest && session}
          <!-- The map key and the page's Layers: after the map's own controls in Tab order, before
               the card. The key is open at rest from md; below md the control hides while the
               card's sheet covers its corner. -->
          <MapKeyControl
            openFromMd
            {layers}
            hidden={narrow.current && cardOpen}
            {stale}
            bind:el={keyEl}
          >
            {#snippet key()}
              <SimKey tally={keyCounts} inForce={keyMarks} />
            {/snippet}
          </MapKeyControl>
        {/if}

        {#if session && calibration && cardChance}
          <div class="tl-dim" data-stale={stale ? 'true' : undefined} data-testid="tl-card">
            <ProjectCardPanel
              state={cardState}
              {day}
              {asOf}
              calibration={{ inFlight: calibration, fresh: calibration }}
              chance={cardChance}
              onclose={closeCard}
              onsource={(id) => about?.open(id)}
              anchor={cardAnchor}
              allowedBy={cardAllowedBy}
              fundedBy={cardFundedBy}
              affordable={cardFunded?.kind === 'affordable'}
              onsize={(s) => (cardSize = s)}
            />
          </div>
          <ProjectTooltip state={tipState} {day} x={tipAt.x} y={tipAt.y} />
        {/if}
      </div>
      {#if calibration && !noScenario}
        <!-- A top-layer modal, so outside the map's box. -->
        <AboutDialog
          bind:this={about}
          {manifest}
          {datasetVersion}
          sections={aboutSections}
          projectsUrl={manifest?.scenarios?.fzp.projects ?? null}
          onopen={() => (playing = false)}
        />
      {/if}
    </div>
  </div>

  {#if mounted && session && calibration}
    <!-- From md the bottom pane: a fixed 40% of the mode box, the timeline beside the detail
         column (rule 1). Below md the timeline is in flow and the column a sheet; while pinned
         the pane is the mode box's height, so the mode box scrolls the map away first, then the
         rows scroll in their own box. -->
    <div
      class="flex shrink-0 flex-col border-t border-line bg-surface md:grid md:h-[40%] md:grid-rows-[minmax(0,1fr)] dark:border-line-dark dark:bg-surface-dark"
      style:height={narrow.current && pinned ? '100%' : undefined}
      style:grid-template-columns={narrow.current
        ? undefined
        : detailShown
          ? 'minmax(0, 3fr) minmax(22rem, 2fr)'
          : 'minmax(0, 1fr)'}
      data-testid="tl-dock"
    >
      <!-- The timeline's box. Pinned, its block sits above the rows' own scroll box, so a row
           never passes under it (WCAG 2.2 2.4.11). A box too short for the block and MIN_ROWS
           of rows makes the timeline one piece: from md this box scrolls it, below md the mode
           box. -->
      <div
        bind:this={dockEl}
        bind:clientHeight={lanesClientH}
        class="flex min-h-0 flex-col max-md:flex-1 {pinned ? '' : 'md:overflow-y-auto'}"
        style:padding-bottom={phoneSheet && !pinned ? '100dvh' : undefined}
        data-testid="tl-lanes"
      >
        <Timeline
          {policy}
          {calibration}
          {asOf}
          {readonly}
          {selected}
          {onselect}
          {onedit}
          {onadd}
          playhead={playheadPart}
          chart={chartPart}
          goalShown={chartTarget !== null}
          {inForce}
          {lens}
          playheadMonth={viewMonthOf(asOf, day)}
          playheadDay={day}
          {levels}
          reached={reveal.reached}
          {stale}
          bind:pinHeight
          {pinned}
          limits={g?.limits ?? OPEN_LIMITS}
        />
      </div>

      {#if detailShown && inspector}
        <!-- From md the column beside the timeline: the inspector while open, else Activity. Below
             md a sheet from under the chart to the mode box's end (top and bottom inline), so the
             playhead and the chart stay above it and nothing past the box is covered (rules 1, 9; W6b). -->
        <aside
          bind:this={detailEl}
          id={scoreControls}
          data-testid="tl-inspector"
          {@attach moreBelow}
          style:top={phoneSheet ? `${sheetTop}px` : undefined}
          style:bottom={phoneSheet ? `${sheetBottom}px` : undefined}
          class="detail-col more-below z-30 overflow-y-auto border-line bg-surface text-ink max-md:fixed max-md:inset-x-0 max-md:rounded-t-2xl max-md:border-t max-md:shadow-lg md:min-h-0 md:border-l dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
        >
          {#if inspectorOpen}
            {@render inspector({ activity, details, day })}
          {:else}
            {@render activity()}
          {/if}
        </aside>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* The zoom and compass control (bottom left) sits above the bottom-right controls' footprint
     (the map's credit, Layers and Key), never under it (WCAG 2.2 2.4.11). The footprint includes
     the bottom inset (docs/dev/map-interfaces.md). */
  .sfh-tl :global(.sim-map .maplibregl-ctrl-bottom-left) {
    bottom: max(var(--map-bottom-inset, 0px), var(--map-controls-br-block-size, 0px));
  }
  /* The same for a coarse pointer's Reset view button (SimMap's own gap, 16 px over the inset). */
  .sfh-tl :global(.sim-map .sim-map-reset) {
    bottom: max(
      calc(var(--map-bottom-inset, 0px) + 16px),
      calc(var(--map-controls-br-block-size, 0px) + 8px)
    );
  }
  /* Stale (rule 31): the map's picture dims, never its controls. */
  .tl-map[data-stale] :global(.maplibregl-canvas) {
    opacity: 0.6;
  }
  /* Details and the card: text turns to the muted ink, which keeps AA contrast; controls keep
     their own colours; graphics outside controls dim. */
  .tl-dim[data-stale]
    :global(:not(button, a, input, select, textarea, summary, button *, a *, summary *)) {
    color: var(--color-ink-muted);
  }
  .tl-dim[data-stale] :global(svg:not(button svg, a svg)) {
    opacity: 0.6;
  }
  @media (prefers-color-scheme: dark) {
    .tl-dim[data-stale]
      :global(:not(button, a, input, select, textarea, summary, button *, a *, summary *)) {
      color: var(--color-ink-dark-muted);
    }
  }
</style>
