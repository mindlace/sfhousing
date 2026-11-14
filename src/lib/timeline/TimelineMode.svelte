<!--
  The /sim and /s/<id> composition on the timeline (timeline-ui rules 1, 18-36): the header score
  and the status slot, the notice stack, the map with the project card and tooltip, the inspector
  beside the map (a sheet on a phone) and the timeline under it (the playhead, the chart and the
  rows), over a `TimelineSession`. It takes FzpMode's place; the load states before the worker
  are FzpMode's (rule 30). The policy store and its editors are the page's: edits arrive as a new
  `policy`, their lots as a new `lots` (PolicySync).
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
   * Who the plan effect is for, from the statics' comparison (rule 26): `scoreCopy`'s wording,
   * which reads only the levers' `compare` ('plan' is the comparison with the plan as written).
   */
  function copyOf(compare: 'plan' | 'preFzp' | null): ScoreCopy {
    return scoreCopy(compare === 'plan' ? ({ compare: 'fzp' } as SimLevers) : null);
  }

  /** Below md the inspector sheet starts under the chart, and is never shorter than this. */
  const MIN_SHEET = 240;

  /** The widest text the status slot shows: its width is reserved (rule 32). */
  const STATUS_WIDEST = 'Forecast filled to 2088';
</script>

<script lang="ts">
  import { onMount, untrack, type Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import type { Manifest } from '$lib/data/manifest';
  import { cardFunding, type CardFunding } from '$lib/fzp/card';
  import { BR_BLOCK, watchCardArea } from '$lib/fzp/card-area-watch';
  import { cardArea, cardPlacement, type CardArea } from '$lib/fzp/card-place';
  import { installFzpDebug } from '$lib/fzp/debug';
  import { marketText as marketSentence, uncappedPoolIds } from '$lib/fzp/money-view';
  import { DEFAULT_SPEED } from '$lib/fzp/playback';
  import ProjectCardPanel from '$lib/fzp/ProjectCardPanel.svelte';
  import ProjectTooltip from '$lib/fzp/ProjectTooltip.svelte';
  import { RHNA_ID, homesAddedBy, scoreAt, scrubMarkers } from '$lib/fzp/score-view';
  import SimResults from '$lib/fzp/SimResults.svelte';
  import SourcesDialog from '$lib/fzp/SourcesDialog.svelte';
  import { SummaryRequester, type SummaryState } from '$lib/fzp/summary-request';
  import { monthIndex, monthStart } from '$lib/fzp/time';
  import type { FzpPhase, Speed } from '$lib/fzp/types';
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
  import { fillStatusText } from './fill';
  import { fundsOf4 } from './owner';
  import Playhead from './Playhead.svelte';
  import { filledEndDay, indexOfDay, viewMonthOf } from './playhead';
  import { spanAt, type PolicyKind, type SimPolicy4 } from './policy4';
  import { headerOf, scoreOfView } from './results';
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
    /** The page's status (the save state), first in the header's status slot. */
    status?: Snippet;
    /** The page's own notices, first in the notice stack; each should be a `PILL`. */
    notices?: Snippet;
    /** The document on show; a new object after open is an edit (rule 25). */
    policy: SimPolicy4;
    /** The lots of `policy`'s brush queries; null while one is unresolved (PolicySync). */
    lots: Lots | null;
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
    /** The inspector shows (default true): beside the map from md, a sheet below. */
    inspectorOpen?: boolean;
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
    /** The inspector shows Results: the header score's `aria-expanded`. */
    scoreExpanded?: boolean;
    /** The inspector's id: the header score's `aria-controls`. */
    scoreControls?: string;
    /** Px added to the map's bottom inset (a phone sheet over it). Default 0. */
    bottomExtra?: number;
    /** Test seam: the status slot's least gap between updates (rule 32). */
    statusMs?: number;
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
    readonly,
    onedit,
    onundoto,
    selected,
    onselect,
    onadd,
    inspector = undefined,
    inspectorOpen = true,
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
  const index = $derived(months && months.length > 0 ? indexOfDay(months, day) : 0);
  const shown = $derived(session ? session.shown(index) : { view: null, stale: false });
  /** The numbers on show are from before the latest change (rule 31). */
  const stale = $derived(shown.stale);
  /** The filled mark: the playhead stops there (rule 24). */
  const filledEnd = $derived(
    current ? filledEndDay(current.months, current.filledThrough, asOf) : asOf
  );
  const playable = $derived(session ? session.playAvailable() : false);
  const tierBaseline = $derived(statics?.tierBaseline ?? null);
  /** Today's score shape over the view on show (rule 26). */
  const score = $derived(shown.view ? scoreOfView(shown.view, tierBaseline) : null);
  const shownFilled = $derived(shown.view?.filledThrough ?? -1);
  // `resultsAt` without a second `scoreOfView`: the score above is the view's, built once.
  const at = $derived(score && index <= shownFilled ? scoreAt(score, index) : null);
  const city = $derived(
    shown.view && index <= shownFilled
      ? shown.view.baseline.completedNet + Math.round(shown.view.shown[index].completedNet)
      : null
  );
  const shownEnd = $derived(
    shown.view ? filledEndDay(shown.view.months, shown.view.filledThrough, asOf) : asOf
  );
  const markers = $derived(score ? scrubMarkers(score) : []);
  const copy = $derived(copyOf(statics?.compare ?? null));
  /** Rule 27 (OQ-3: "calculating" while provisional). */
  const header = $derived(
    headerOf(
      !session || session.provisional || !statics ? null : session.shown(statics.lastIndex).view
    )
  );
  const chartTarget = $derived.by(() => {
    const v = current;
    const rhna = v?.targets.find((t) => t.target.id === RHNA_ID);
    if (!v || !rhna) return null;
    return {
      deadlineIndex: monthIndex(rhna.deadline, v.months[0], v.months.length),
      units: rhna.target.units
    };
  });
  const funds = $derived(fundsOf4(policy));
  /** The market terms in force at the playhead, for the Results' lost-grants line. */
  const terms = $derived.by(() => {
    const t = policy.kinds.money
      .filter((p) => p.where.tag === 'terms')
      .map((p) => spanAt(p, day)?.what)
      .find((w) => w?.tag === 'terms');
    return resolveTerms(MARKET_TERMS, t?.tag === 'terms' ? t.terms : {});
  });
  const uncapped = $derived(uncappedPoolIds(calibration?.baselineFunding?.pools, funds.pools));
  const phase = $derived<FzpPhase>(
    noScenario ? 'no-scenario' : failed ? 'failed' : (session?.phase ?? 'loading')
  );
  const halted = $derived(
    session?.notices.some((n) => n.id === 'error' || n.id === 'crash') ?? false
  );

  // ---- the status slot (rules 31, 32) ----

  const statusWanted = $derived(!session ? '' : stale ? UPDATING : fillStatusText(current));
  let statusText = $state('');
  let statusAt = -Infinity;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;
  /** At most one change a second: a change inside the gap goes out when it ends (latest wins). */
  function showStatus(want: string): void {
    if (statusTimer !== null) clearTimeout(statusTimer);
    statusTimer = null;
    if (want === statusText) return;
    const wait = statusAt + statusMs - performance.now();
    if (wait <= 0) {
      statusText = want;
      statusAt = performance.now();
      return;
    }
    statusTimer = setTimeout(() => {
      statusTimer = null;
      statusText = want;
      statusAt = performance.now();
    }, wait);
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

  /** The playhead moved (once per change): the view month, the map's time, the card's month. */
  function handleDay(d: Day): void {
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

  // An edit (a new document): the edit is marked at once and playback pauses (rule 25).
  $effect(() => {
    const p = policy;
    untrack(() => {
      if (!session || p === seenPolicy) return;
      seenPolicy = p;
      session.edited();
      playing = false;
    });
  });

  // The edit's lots settled (or a provisional open's): the pair goes out.
  $effect(() => {
    const l = lots;
    untrack(() => {
      if (!session || l === null || l === seenLots) return;
      seenLots = l;
      session.send(policy, l);
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
  const inspectorShown = $derived(mounted && session !== null && !!inspector && inspectorOpen);
  /** Below md with the inspector open: it is a sheet under the chart. */
  const phoneSheet = $derived(inspectorShown && narrow.current);
  let dockEl = $state<HTMLElement>();
  let chartBox = $state<HTMLElement>();
  let sheetTop = $state(0);

  function placeSheet(): void {
    if (!chartBox) return;
    const bottom = chartBox.getBoundingClientRect().bottom;
    sheetTop = Math.max(0, Math.min(bottom, window.innerHeight - MIN_SHEET));
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
      refills,
      mean: () =>
        current ? current.mean.slice(0, current.filledThrough + 1).map((r) => r.completedNet) : []
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

{#snippet statusSlot()}
  {@render status?.()}
  {#if !noScenario}
    <!-- The shown text shares one grid cell with the widest one: the slot keeps its width (rule
         32). The live region holds the status text only; "Updating"'s explanation sits beside
         it, outside, and opens as a popover at every width so the header keeps its size. -->
    <span
      class="tl-status relative inline-grid text-sm text-ink-muted tabular-nums dark:text-ink-dark-muted"
      data-testid="tl-status"
    >
      <span aria-hidden="true" class="invisible col-start-1 row-start-1 whitespace-nowrap"
        >{STATUS_WIDEST}</span
      >
      <span role="status" class="sr-only">{statusText}</span>
      <span
        aria-hidden={statusText === UPDATING ? undefined : 'true'}
        class="col-start-1 row-start-1 whitespace-nowrap"
      >
        {#if statusText === UPDATING}
          <Explain text={STALE_NOTE}>{UPDATING}</Explain>
        {:else}
          {statusText}
        {/if}
      </span>
    </span>
  {/if}
{/snippet}

{#snippet scoreBar()}
  {#if session && calibration}
    <TimelineHeaderScore
      total={header.total}
      year={header.year}
      target={header.target}
      delta={header.delta}
      provisional={session.provisional}
      busy={stale}
      {stale}
      expanded={scoreExpanded}
      controls={inspectorShown ? (scoreControls ?? '') : ''}
      onclick={() => onscore?.()}
      live={at ? homesAddedBy(day, at) : ''}
      quiet={playing}
    />
  {/if}
{/snippet}

{#snippet results()}
  <div class="tl-dim" data-testid="tl-results" data-stale={stale ? 'true' : undefined}>
    <SimResults
      {score}
      {at}
      {day}
      {asOf}
      {city}
      horizon={windowEnd}
      filledEnd={shownEnd}
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
    end={filledEnd}
    bind:day
    bind:playing
    bind:speed
    {playable}
    {markers}
    onday={handleDay}
  />
{/snippet}

{#snippet chartPart()}
  <div bind:this={chartBox}>
    <ChartRow view={current} {index} target={chartTarget} />
  </div>
{/snippet}

<!-- Below md the page scrolls: the map keeps a fixed share and the timeline follows in flow, so a
     kind's sheet can scroll the playhead and the chart to the top above it (rule 9). -->
<div
  class="sfh-fzp sfh-tl relative flex h-full flex-col max-md:overflow-y-auto"
  data-testid="tl-mode"
>
  <!-- Every notice is a pill in this one stack (as FzpMode). -->
  <NoticePills bind:el={pillsEl}>
    {#if noScenario}
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
              <span class={PILL}>
                <span>Part of the simulation stopped.</span>
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

    {#if inspectorShown && inspector}
      <!-- Beside the map from md, leaving the timeline in view; below md a sheet from under the
           chart to the bottom, so the playhead and the chart stay above it (rules 1, 9). -->
      <aside
        id={scoreControls}
        data-testid="tl-inspector"
        style:top={phoneSheet ? `${sheetTop}px` : undefined}
        class="z-30 overflow-y-auto border-line bg-surface text-ink max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:rounded-t-2xl max-md:border-t max-md:shadow-lg md:w-96 md:shrink-0 md:border-l dark:border-line-dark dark:bg-surface-dark dark:text-ink-dark"
      >
        {@render inspector({ results, day })}
      </aside>
    {/if}
  </div>

  {#if mounted && session && calibration}
    <div
      bind:this={dockEl}
      class="shrink-0 border-t border-line bg-surface md:max-h-[50%] md:overflow-y-auto dark:border-line-dark dark:bg-surface-dark"
      style:padding-bottom={phoneSheet ? '100dvh' : undefined}
      data-testid="tl-dock"
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
        playheadMonth={viewMonthOf(asOf, day)}
        {filledEnd}
      />
    </div>
  {/if}
</div>

<style>
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
  /* "Updating"'s explanation opens under the slot at every width (Explain is inline below md),
     so the header neither widens nor grows. */
  .tl-status :global([role='tooltip']) {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 40;
    width: max-content;
    max-width: min(14rem, calc(100vw - 2rem));
    white-space: normal;
    margin-top: 0.25rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--color-line);
    border-radius: 0.25rem;
    background: var(--color-surface);
    color: var(--color-ink);
    box-shadow: 0 4px 6px rgb(0 0 0 / 0.1);
  }
  @media (prefers-color-scheme: dark) {
    .tl-status :global([role='tooltip']) {
      border-color: var(--color-line-dark);
      background: var(--color-surface-dark);
      color: var(--color-ink-dark);
    }
  }
</style>
