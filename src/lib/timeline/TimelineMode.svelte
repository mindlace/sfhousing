<!--
  The /sim and /s/<id> composition on the timeline (timeline-ui rules 1, 18-36): the header score
  and the status slot, the notice stack, the map with the project card and tooltip, and under the
  map the bottom pane: the timeline (the playhead, the chart and the rows) beside the detail
  column (the inspector, or Results; a sheet on a phone), over a `TimelineSession`. It takes
  FzpMode's place; the load states before the worker are FzpMode's (rule 30). The policy store and
  its editors are the page's: edits arrive as a new `policy`, their lots as a new `lots`
  (PolicySync).
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
   * may mutate them (as FzpMode).
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
   * Px of rows the pinned block must leave in its box (a 44 px coarse row with room around it);
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
  import { marketText as marketSentence, uncappedPoolIds } from '$lib/fzp/money-view';
  import { DEFAULT_SPEED } from '$lib/fzp/playback';
  import ProjectCardPanel from '$lib/fzp/ProjectCardPanel.svelte';
  import ProjectTooltip from '$lib/fzp/ProjectTooltip.svelte';
  import SimResults from '$lib/fzp/SimResults.svelte';
  import SourcesDialog from '$lib/fzp/SourcesDialog.svelte';
  import { SummaryRequester, type SummaryState } from '$lib/fzp/summary-request';
  import { monthStart } from '$lib/fzp/time';
  import type { FzpPhase, Speed } from '$lib/fzp/types';
  import { GOAL, TODAY, goalStep, type Goal } from '$lib/goal/goal';
  import type { HeightCity } from '$lib/map/height/types';
  import SimMap from '$lib/map/SimMap.svelte';
  import type { ChunkStatus, TimelinePick, TimelineUpdate } from '$lib/map/types';
  import { useHeaderActions } from '$lib/shell/header-actions.svelte';
  import NoticePills from '$lib/shell/NoticePills.svelte';
  import { PILL, PILL_ACTION } from '$lib/shell/pill';
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
  import { CHANGE_NOT_APPLIED, STALE_NOTE, UPDATING } from './copy';
  import Explain from './Explain.svelte';
  import { fundsOf4 } from './owner';
  import Playhead from './Playhead.svelte';
  import { clampDay, filledEndDay, indexOfDay, viewMonthOf } from './playhead';
  import { termsInForce } from './lens';
  import { nothingInForce, type PolicyKind, type SimPolicy4 } from './policy4';
  import { awaitsView, goalOutcome, outcomeKey, outcomeText, type GoalOutcome } from './outcome';
  import { editedReveal, moved, revealOpen, scanned, type Reveal } from './reveal';
  import {
    headlineAt,
    headlineSpoken,
    headlineText,
    playheadAt,
    resultsAt,
    scoreOfView
  } from './results';
  import { TimelineSession, type Lots, type SessionNotice } from './session.svelte';
  import type { SpanRef } from './spans';
  import Timeline from './Timeline.svelte';
  import TimelineHeaderScore from './TimelineHeaderScore.svelte';

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
    /**
     * The page's status (the save state), in the header's status slot. Its argument is true while
     * "Updating" covers it (the cell hides it): its controls should go inert and a popover of its
     * own close, while a live region of its own sets `visibility: visible` to keep speaking.
     */
    status?: Snippet<[covered: boolean]>;
    /** The page's own notices, first in the notice stack; each should be a `PILL`. */
    notices?: Snippet;
    /** The document on show; a new object after open is an edit (rule 25). */
    policy: SimPolicy4;
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
    /** The page's inspector, given the Results face and the playhead's day. */
    inspector?: Snippet<[{ results: Snippet; day: Day }]>;
    /**
     * The inspector is open (default true). Below md it is a sheet that shows only while open;
     * from md the detail column beside the timeline always shows: the inspector while open,
     * else Results.
     */
    inspectorOpen?: boolean;
    /** What the detail column shows (Results, an editor, a menu): a new key starts it at its top. */
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
    /** The zoning in force at the last view month: height regions and contours. */
    onheights?(c: HeightCity): void;
    /** A chunk response arrived (lots may have loaded). */
    onchunks?(): void;
    /** A map tap that opened no card (the page selects by lot, rule 19). */
    onmiss?(): void;
    /** The header score is pressed. */
    onscore?(): void;
    /** The sheet shows Results: the header score's `aria-expanded`, below md only. */
    scoreExpanded?: boolean;
    /** The detail column's id: the header score's `aria-controls` while the column shows. */
    scoreControls?: string;
    /** Px added to the map's bottom inset (a phone sheet over it). Default 0. */
    bottomExtra?: number;
    /** Test seam: the status slot's least gap between updates (rule 32). */
    statusMs?: number;
    /** Test seam: the goal every goal read goes through. Default the page's goal. */
    goal?: Goal;
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
    status = undefined,
    notices = undefined,
    policy,
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
    onheights = undefined,
    onchunks = undefined,
    onmiss = undefined,
    onscore = undefined,
    scoreExpanded = false,
    scoreControls = undefined,
    bottomExtra = 0,
    goal = GOAL,
    statusMs = 1000
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

  // Until SimMap's handle exists, cells and chunk statuses wait here, in order (as FzpMode).
  let pendingUpdates: TimelineUpdate[] = [];
  const pendingStatus = new Map<string, ChunkStatus>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  const statusCells = new Set<string>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  let pushedLookups: MapLookups | null = null;
  /** The worker's latest posted permitting tables (rule 20); null before the first. */
  let leverLookups: LeverLookups | null = null;

  const asOf = $derived(calibration?.asOf ?? 0);
  const windowEnd = $derived(monthLastDay(asOf, WINDOW_MONTHS));
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
  /** Today's score shape over the view on show (rule 26). */
  const score = $derived(shown.view ? scoreOfView(shown.view, tierBaseline) : null);
  const shownFilled = $derived(shown.view?.filledThrough ?? -1);
  /** `resultsAt` over the score above (the view's, built once). */
  const at = $derived(
    shown.view && score && index <= shownFilled
      ? resultsAt(shown.view, tierBaseline, index, score)
      : null
  );
  const shownEnd = $derived(
    shown.view ? filledEndDay(shown.view.months, shown.view.filledThrough, asOf) : asOf
  );
  /**
   * The document the shown numbers are from: the one the worker runs, or while stale the one it
   * ran when the held view was taken; the edited `policy` until the session has one.
   */
  let heldDoc = $state.raw<SimPolicy4 | null>(null);
  const resultsDoc = $derived((stale ? heldDoc : null) ?? session?.accepted ?? policy);
  /** A policy of the person's is in force in the document the numbers on show are from. */
  const inForce = $derived(!nothingInForce(resultsDoc));
  /**
   * The comparison's wording for Results and the header, from the document the numbers on show
   * are from, so it changes with the numbers (held numbers keep theirs).
   */
  const copy = $derived(copyOf(!inForce));
  /** The playhead is at the dataset date: the headline reads today. */
  const atToday = $derived(playheadAt(months ?? [], asOf, day).atToday);
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
  const chartTarget = $derived(current ? goalStep(goal, current) : null);
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
  $effect(() => {
    const view = shown.view;
    const m = reachedMonth;
    const g = goal;
    const wait = stale || searching;
    untrack(() => {
      if (wait) return;
      const day = m === TODAY || !view ? asOf : view.months[m];
      // A view not yet covering the months read is no answer: the last outcome stays.
      if (awaitsView(g, view, day, asOf)) return;
      const next = goalOutcome(g, view, day, asOf);
      const same =
        next === outcome ||
        (next !== null && outcome !== null && outcomeKey(next) === outcomeKey(outcome));
      if (!same) outcome = next;
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
    const target = next?.isConnected
      ? next
      : (modeEl ?? document).querySelector<HTMLElement>('[data-testid=tl-ruler]');
    target?.focus();
  }
  const goalNotice = $derived(
    outcome && !dismissed.has(outcomeKey(outcome)) ? outcomeText(outcome, goal, inForce) : null
  );
  // The held document goes once the numbers on show are current again.
  $effect(() => {
    if (!stale) untrack(() => (heldDoc = null));
  });
  const funds = $derived(fundsOf4(resultsDoc));
  /** The market terms in force at the playhead, for the Results' lost-grants line. */
  const terms = $derived(resolveTerms(MARKET_TERMS, termsInForce(resultsDoc, day)));
  const uncapped = $derived(uncappedPoolIds(calibration?.baselineFunding?.pools, funds.pools));
  const phase = $derived<FzpPhase>(
    noScenario ? 'no-scenario' : failed ? 'failed' : (session?.phase ?? 'loading')
  );
  const halted = $derived(
    session?.notices.some((n) => n.id === 'error' || n.id === 'crash') ?? false
  );

  // ---- the status slot (rules 31, 32) ----

  /** "Updating" while the numbers are stale, else nothing. */
  const statusWanted = $derived(session && stale ? UPDATING : '');
  let statusText = $state('');
  /** "Updating" shows: it covers the page's save state in the slot's one cell. */
  const covered = $derived(statusText === UPDATING);
  let statusAt = -Infinity;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  /** At most one change a second: a change inside the gap goes out when it ends (latest wins). */
  function showStatus(want: string): void {
    if (statusTimer !== null) clearTimeout(statusTimer);
    statusTimer = null;
    if (want === statusText) return;
    const wait = statusAt + statusMs - performance.now();
    if (wait <= 0) {
      setStatus(want);
      return;
    }
    statusTimer = setTimeout(() => {
      statusTimer = null;
      setStatus(want);
    }, wait);
  }
  /** The save state's part of the slot's cell and the shown "Updating" (bound in the snippet). */
  let saveCell = $state<HTMLElement>();
  let shownCell = $state<HTMLElement>();
  /**
   * Shows `want`. Focus inside the part about to be covered or removed is not dropped to the
   * body (WCAG 2.4.3): the save state's focused control hands it to "Updating"'s explanation, in
   * the same place; that explanation hands it back to the save state's control if one shows,
   * else to the header score.
   */
  function setStatus(want: string): void {
    const active = document.activeElement;
    const covering = want === UPDATING && !!saveCell?.contains(active);
    const uncovering = want !== UPDATING && !!shownCell?.contains(active);
    statusText = want;
    statusAt = performance.now();
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
    untrack(() => showStatus(want));
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
  let dialog = $state<ReturnType<typeof SourcesDialog>>();
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
    const next = cardArea(
      { left: m.left, top: m.top, width: m.width, height: m.height },
      pillsEl ? pillsEl.getBoundingClientRect() : null,
      0,
      0,
      { left: zoom && zoom.width > 0 ? zoom.right - m.left : 0, bottom: br }
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
        controls: mapBox.querySelector<HTMLElement>('.maplibregl-ctrl-bottom-left')
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

  /** The restarted worker reports only the cells it fetches (as FzpMode). */
  function resetChunkStatuses(): void {
    for (const cellId of statusCells) setChunkStatus(cellId, 'ready');
    statusCells.clear();
  }

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
    if (calibration) h.setTime(day);
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
    const [p, l] = untrack(() => [policy, lots] as const);
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

  // An edit (a new document): the edit is marked at once and playback pauses (rule 25). The
  // reveal starts looking for the first month it changed, against the numbers on show now (a
  // search already under way keeps what was seen first).
  $effect(() => {
    const p = policy;
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
      const now = v ? { view: v, inForce: !nothingInForce(session.accepted ?? policy) } : null;
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
    void policy;
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
      if (!session.send(policy, l)) return;
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
  /** The detail column shows: always from md (Results when nothing is open), below md while open. */
  const detailShown = $derived(
    mounted && session !== null && !!inspector && (!narrow.current || inspectorOpen)
  );
  /** Below md the detail column is a sheet under the chart. */
  const phoneSheet = $derived(detailShown && narrow.current);
  let dockEl = $state<HTMLElement>();
  let detailEl = $state<HTMLElement>();

  /** The column's content swaps (Results, an editor, another editor): it starts at the top. */
  $effect(() => {
    void inspectorOpen;
    void detailKey;
    const el = detailEl;
    if (el) el.scrollTop = 0;
  });

  /** The header score's press from md: the column at its top, focus on Results. */
  export async function showResults(): Promise<void> {
    await tick();
    if (!detailEl) return;
    detailEl.scrollTop = 0;
    detailEl.querySelector<HTMLElement>('[data-testid=tl-results]')?.focus({ preventScroll: true });
  }
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
     is as wide as the widest and nothing moves as either comes or goes. The save state's own live
     region opts back into visibility, so its announcements still reach screen readers. The
     timeline's live region is apart, once, in the page; "Updating"'s explanation opens as a
     popover under the slot (`explain-under`, layout.css), so the header keeps its size. -->
{#snippet statusSlot()}
  <span class="inline-grid items-center" data-testid="tl-status-group">
    <span
      bind:this={saveCell}
      class={['col-start-1 row-start-1 inline-flex items-center', covered && 'invisible']}
      >{@render status?.(covered)}</span
    >
    {#if !noScenario}
      <!-- Over the save state in the cell: it takes presses only while "Updating" shows. -->
      <span
        class={[
          'tl-status explain-under relative col-start-1 row-start-1 inline-grid text-sm text-ink-muted tabular-nums dark:text-ink-dark-muted',
          !covered && 'pointer-events-none'
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
          {#if statusText === UPDATING}
            <Explain text={STALE_NOTE}>{UPDATING}</Explain>
          {/if}
        </span>
      </span>
    {/if}
  </span>
{/snippet}

{#snippet scoreBar()}
  {#if session && calibration}
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

{#snippet results()}
  <!-- Focused by showResults: the ring draws inside the box, which sits flush in the column's
       scroll box and would clip an outer one (WCAG 2.4.7). -->
  <div
    class="tl-dim focus:outline-2 focus:-outline-offset-2 focus:outline-accent dark:focus:outline-accent-dark"
    data-testid="tl-results"
    data-stale={stale ? 'true' : undefined}
    tabindex="-1"
  >
    <SimResults
      {score}
      {at}
      view={score ? shown.view : null}
      {day}
      {asOf}
      horizon={windowEnd}
      filledEnd={shownEnd}
      reached={Math.min(reveal.reached, shownEnd)}
      {datasetVersion}
      builtAt={manifest?.builtAt ?? ''}
      onsources={() => dialog?.open()}
      {copy}
      capacity={session?.capacity ?? null}
      pending={stale}
      {terms}
      {uncapped}
      market={calibration ? marketSentence(calibration) : null}
    />
  </div>
{/snippet}

{#snippet playheadPart()}
  <Playhead
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
    <!-- Every notice is a pill in this one stack (as FzpMode). -->
    <NoticePills bind:el={pillsEl}>
      {#if noScenario}
        <div
          role="status"
          data-testid="fzp-status"
          class="{PILL} w-[min(28rem,100%)]! flex-col! items-start! gap-0! rounded-lg! pr-4 pb-0"
        >
          <p>
            The simulation isn't available for dataset {datasetVersion}. It needs data this dataset
            doesn't have.
          </p>
          <a href="/" class="inline-flex min-h-11 items-center font-semibold underline"
            >Go to the editor</a
          >
        </div>
      {:else if failed}
        <div class={PILL}>
          <p role="alert" data-testid="fzp-status">The simulation couldn't load.</p>
          <button type="button" class="shrink-0 {PILL_ACTION}" onclick={() => void retryLoad()}
            >Retry</button
          >
        </div>
      {:else}
        {#if session}
          {@render notices?.()}
          <!-- The goal notice's polite region, mounted empty with the session so the first notice
               is announced. -->
          <div role="status" data-testid="tl-goal" class="contents">
            {#if outcome && goalNotice !== null}
              <span class={PILL} data-testid="tl-goal-notice">
                <span>{goalNotice}</span>
                <button type="button" aria-label="Dismiss" class={PILL_ACTION} onclick={dismissGoal}
                  >×</button
                >
              </span>
            {/if}
          </div>
        {/if}
        {#if phase === 'loading' && !halted}
          <p role="status" data-testid="fzp-status" class="{PILL} pr-4">Loading the simulation…</p>
        {/if}
        {#if session}
          <div role="status" data-testid="tl-notices" class="contents">
            {#each session.notices as n (n.id)}
              {#if n.id === 'failed-cells'}
                <span class={PILL}>
                  <span>Some map data didn't load.</span>
                  <button type="button" class={PILL_ACTION} onclick={() => retryNotice(n)}
                    >Retry</button
                  >
                </span>
              {:else if n.id === 'crash'}
                <!-- Rule 35's wording: before the first fill nothing had run to stop. -->
                <span class={PILL}>
                  <span
                    >{session.phase === 'ready'
                      ? 'Part of the simulation stopped.'
                      : "The simulation couldn't load."}</span
                  >
                  <button type="button" class={PILL_ACTION} onclick={() => retryNotice(n)}
                    >Retry</button
                  >
                </span>
              {/if}
            {/each}
          </div>
          <div role="alert" data-testid="tl-alerts" class="contents">
            {#each session.notices as n (n.id)}
              {#if n.id === 'error'}
                <span class={PILL}>
                  <span>{n.text}</span>
                  <button type="button" class={PILL_ACTION} onclick={() => retryNotice(n)}
                    >Retry</button
                  >
                </span>
              {:else if n.id === 'not-applied'}
                <span class={PILL}>
                  <span>{CHANGE_NOT_APPLIED}</span>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    class={PILL_ACTION}
                    onclick={() => session?.dismiss('not-applied')}>×</button
                  >
                </span>
              {/if}
            {/each}
            {#if lotsFailed && lots === null}
              <span class={PILL} data-testid="tl-lots-failed">
                <span>{LOTS_FAILED}</span>
                <button type="button" class={PILL_ACTION} onclick={() => onlotsretry?.()}
                  >Retry</button
                >
              </span>
            {/if}
          </div>
        {/if}
      {/if}
    </NoticePills>

    <div class="relative flex min-h-0 flex-1 max-md:h-[40%] max-md:flex-none">
      <!-- The map and everything positioned over it. -->
      <div bind:this={mapBox} class="relative min-h-0 min-w-0 flex-1">
        <div class="tl-map h-full" data-testid="tl-map" data-stale={stale ? 'true' : undefined}>
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
        </div>

        {#if session && calibration && cardChance}
          <div class="tl-dim" data-stale={stale ? 'true' : undefined} data-testid="tl-card">
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
              fundedBy={cardFundedBy}
              affordable={cardFunded?.kind === 'affordable'}
              onsize={(s) => (cardSize = s)}
            />
          </div>
          <ProjectTooltip state={tipState} {day} x={tipAt.x} y={tipAt.y} />
        {/if}

        {#if calibration && !noScenario}
          <SourcesDialog
            bind:this={dialog}
            {calibration}
            {score}
            projectsUrl={manifest?.scenarios?.fzp.projects ?? null}
            {asOf}
            {terms}
            onopen={() => (playing = false)}
          />
        {/if}
      </div>
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
          playheadMonth={viewMonthOf(asOf, day)}
          playheadDay={day}
          bind:pinHeight
          {pinned}
        />
      </div>

      {#if detailShown && inspector}
        <!-- From md the column beside the timeline: the inspector while open, else Results. Below
             md a sheet from under the chart to the mode box's end (top and bottom inline), so the
             playhead and the chart stay above it and nothing past the box is covered (rules 1, 9; W6b). -->
        <aside
          bind:this={detailEl}
          id={scoreControls}
          data-testid="tl-inspector"
          style:top={phoneSheet ? `${sheetTop}px` : undefined}
          style:bottom={phoneSheet ? `${sheetBottom}px` : undefined}
          class="z-30 overflow-y-auto border-line bg-surface text-ink max-md:fixed max-md:inset-x-0 max-md:rounded-t-2xl max-md:border-t max-md:shadow-lg md:min-h-0 md:border-l dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
        >
          {#if inspectorOpen}
            {@render inspector({ results, day })}
          {:else}
            {@render results()}
          {/if}
        </aside>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* A narrow or short map wraps the attribution (bottom right) across its width: the zoom and
     compass control (bottom left) sits above the attribution's footprint, never under it (WCAG
     2.2 2.4.11). The footprint includes the bottom inset (docs/dev/map-interfaces.md). */
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
  /* Results and the card: text turns to the muted ink, which keeps AA contrast; controls keep
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
