<!--
  The /lesscars page body (Plan 2 Task 9): SimMap with the plan's own MapLibre layers (streets,
  transit, freed land, garages), the playback worker's buildings, the time scrubber, the header
  headline (pinned) with its details, the Timeline and Evidence header actions and dialogs, and the
  building card. Queueing before the map handle, chunk statuses, prefetch on moveend and the crash
  Retry follow FzpMode (copied, not imported). The plan layers come from the main-thread files, so
  they keep working while the buildings load or fail. Nobody edits anything but the day.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { FeatureCollection, Point } from 'geojson';
  import { LESSCARS_HORIZON, LESSCARS_START } from '$lib/data/lesscars/schedule';
  import { DEFAULT_SPEED } from '$lib/fzp/playback';
  import { monthStart } from '$lib/fzp/time';
  import TimeScrubber from '$lib/fzp/TimeScrubber.svelte';
  import type { Speed } from '$lib/fzp/types';
  import SimMap from '$lib/map/SimMap.svelte';
  import { useSystemTheme } from '$lib/map/system-theme.svelte';
  import type { ChunkStatus, SimMapHandle, TimelinePick, TimelineUpdate } from '$lib/map/types';
  import { useHeaderActions } from '$lib/shell/header-actions.svelte';
  import { spawnSimWorker } from '$lib/sim/client';
  import {
    PlaybackClient,
    type PlaybackClientEvents,
    type PlaybackWorkerInput
  } from '$lib/sim/lesscars/playback-client';
  import type { PlaybackCard } from '$lib/sim/lesscars/types';
  import { chanceTable, typicalMonths } from '$lib/timelapse/model';
  import type { Day } from '$lib/timelapse/time';
  import { HIDDEN_VIEW } from '$lib/view/prefs';
  import { installLessCarsDebug } from './debug';
  import DetailsPanel from './DetailsPanel.svelte';
  import { evidenceSectionId } from './evidence';
  import EvidenceDialog from './EvidenceDialog.svelte';
  import {
    garageFeatures,
    lineFeatures,
    siteFeatures,
    stopFeatures,
    streetFeatures,
    type GarageProps,
    type Reservation
  } from './features';
  import HeadlineBar from './HeadlineBar.svelte';
  import LessCarsCard from './LessCarsCard.svelte';
  import type { LessCarsData } from './load';
  import { installLessCarsLayers, type LessCarsLayers } from './map-layers';
  import { mergeMarkers, scrubberMarkers } from './timeline-view';
  import TimelineDialog from './TimelineDialog.svelte';

  type MapLike = NonNullable<ReturnType<SimMapHandle['getMap']>>;

  interface Props {
    data: LessCarsData;
    /** Tests inject a fake worker. */
    createWorker?: () => PlaybackWorkerInput;
  }
  let { data, createWorker = spawnSimWorker }: Props = $props();

  // `data` is fixed for a mount: a new manifest remounts the component ({#key} in the route).
  const { manifest, calibration, plan, sites, summary } = untrack(() => data);
  const planLayers = {
    streets: streetFeatures(plan),
    lines: lineFeatures(plan),
    stops: stopFeatures(plan),
    sites: siteFeatures(plan, sites)
  };
  const NO_GARAGES: FeatureCollection<Point, GarageProps> = {
    type: 'FeatureCollection',
    features: []
  };
  const allMarkers = scrubberMarkers(plan, summary.switchDay);
  /** The scrubber track's width; near markers fold into one so none overlaps (WCAG 2.5.8). */
  let trackPx = $state(0);
  const markers = $derived(mergeMarkers(allMarkers, trackPx));
  let scrubberBox = $state<HTMLDivElement>();

  // TimeScrubber is shared with /sim and left untouched, so its range input is measured here.
  $effect(() => {
    const track = scrubberBox?.querySelector('input[type="range"]');
    if (!track) return;
    const ro = new ResizeObserver(() => (trackPx = track.getBoundingClientRect().width));
    ro.observe(track);
    return () => ro.disconnect();
  });

  const theme = useSystemTheme();

  let phase = $state<'loading' | 'ready' | 'failed'>('loading');
  let day = $state<Day>(LESSCARS_START);
  let playing = $state(false);
  let speed = $state<Speed>(DEFAULT_SPEED);
  let scrubberH = $state(0);
  let noticeH = $state(0);

  let cardOpen = $state(false);
  let card = $state.raw<PlaybackCard | null>(null);
  let cardLoading = $state(false);

  let timelineDialog = $state<ReturnType<typeof TimelineDialog>>();
  let evidenceDialog = $state<ReturnType<typeof EvidenceDialog>>();

  // Debug-hook state (read on demand; not rendered).
  let seed: number | null = null;
  let revision = -1;
  const cells = new Set<string>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  let reservations: Reservation[] = [];

  let client: PlaybackClient | null = null;
  let handle: SimMapHandle | null = null;
  let map: MapLike | null = null;
  let layers: LessCarsLayers | null = null;
  let garages = NO_GARAGES;
  let dead = false;
  /** Until SimMap's handle exists, playback revisions and chunk statuses wait here, in order. */
  let pendingUpdates: TimelineUpdate[] = [];
  const pendingStatus = new Map<string, ChunkStatus>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  /** Every cell this worker has given the map a status for, so a restart can clear them. */
  const statusCells = new Set<string>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  /** A current-rev revision has arrived since the last init: the worker can take prefetches. */
  let live = false;
  /** Prefetch the viewport on the first revision after each init. */
  let prefetchDue = false;
  /** The open card's project and the month it was last asked for; a token drops old answers. */
  let cardProject: string | null = null;
  let cardMonth: Day | null = null;
  let cardToken = 0;

  function startPlayback(): void {
    if (!client) return;
    client.init(manifest, plan, sites);
    live = false;
    prefetchDue = true;
  }

  function applyRender(u: TimelineUpdate): void {
    revision = u.revision;
    for (const c of u.cells) cells.add(c.cellId);
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

  /** The restarted worker reports only the cells it fetches (as FzpMode). */
  function resetChunkStatuses(): void {
    for (const cellId of statusCells) setChunkStatus(cellId, 'ready');
    statusCells.clear();
  }

  function prefetchViewport(): void {
    if (!client || client.crashed || !map || !live) return;
    const b = map.getBounds();
    client.prefetch([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  }

  function flushPrefetch(): void {
    if (!prefetchDue || !live || !map) return;
    prefetchDue = false;
    prefetchViewport();
  }

  function attachMap(m: MapLike | null): void {
    if (m === map) return;
    map?.off('moveend', prefetchViewport);
    map = m;
    map?.on('moveend', prefetchViewport);
  }

  function requestCard(): void {
    if (!client || cardProject === null) return;
    const token = ++cardToken;
    cardMonth = monthStart(day);
    cardLoading = true;
    void client.card(cardProject, day).then((c) => {
      if (dead || token !== cardToken) return;
      card = c;
      cardLoading = false;
    });
  }

  function closeCard(): void {
    cardToken++;
    cardOpen = false;
    card = null;
    cardLoading = false;
    cardProject = null;
    cardMonth = null;
  }

  function onPick(p: TimelinePick): void {
    if (p.kind !== 'tap') return;
    if (p.projectId === null) return closeCard();
    cardOpen = true;
    card = null;
    cardProject = p.projectId;
    requestCard();
  }

  /** The scrubber's day changed (once per change): O(1) work, a card request on a new month. */
  function onDay(d: Day): void {
    handle?.setTime(d);
    layers?.setDay(d);
    if (cardMonth !== null && monthStart(d) !== cardMonth) requestCard();
  }

  function applyInset(): void {
    handle?.setBottomInset(scrubberH + noticeH);
  }

  $effect(() => {
    void noticeH;
    untrack(applyInset);
  });

  $effect(() => {
    const t = theme.current;
    untrack(() => layers?.setTheme(t));
  });

  function openTimeline(): void {
    playing = false;
    timelineDialog?.show();
  }

  function openEvidence(projectId?: string): void {
    playing = false;
    evidenceDialog?.show(projectId === undefined ? undefined : evidenceSectionId(projectId));
  }

  const events: PlaybackClientEvents = {
    onLoaded(r) {
      if (dead) return;
      seed = r.seed;
      reservations = r.reservations;
      garages = garageFeatures(plan, sites, r.places, r.reservations);
      layers?.setData('garages', garages);
    },
    onTimeline(t) {
      if (dead) return;
      applyRender(t.render);
      phase = 'ready';
      live = true;
      flushPrefetch();
    },
    onChunks(c) {
      if (dead) return;
      for (const [cellId, s] of Object.entries(c.status)) setChunkStatus(cellId, s);
    },
    onError(e) {
      if (dead) return;
      console.error('[lesscars] playback failed', e.code, e.message);
      phase = 'failed';
    },
    onCrash() {
      if (dead) return;
      phase = 'failed';
    }
  };

  function retry(): void {
    if (dead || !client) return;
    client.restart(createWorker());
    resetChunkStatuses();
    phase = 'loading';
    startPlayback();
    if (cardOpen) requestCard();
  }

  function onMapReady(h: SimMapHandle): void {
    if (dead) return;
    handle = h;
    h.setTimelineLookups({
      chance: chanceTable(calibration),
      typicalMonths: typicalMonths(calibration)
    });
    h.onResyncNeeded(() => {
      // The host restarts with no viewport cells: prefetch again once its revision 0 lands.
      live = false;
      prefetchDue = true;
      client?.resync();
    });
    const queued = pendingUpdates;
    pendingUpdates = [];
    for (const u of queued) h.applyTimeline(u);
    for (const [cellId, s] of pendingStatus) h.setChunkStatus(cellId, s);
    pendingStatus.clear();
    const m = h.getMap();
    if (m) layers = installLessCarsLayers(m, { ...planLayers, garages }, theme.current, day);
    h.setTime(day);
    applyInset();
    attachMap(m);
    flushPrefetch();
  }

  useHeaderActions(headerActions, { pinned: headline });

  onMount(() => {
    client = new PlaybackClient(createWorker(), events);
    startPlayback();
    applyInset();
    const uninstall = installLessCarsDebug(() => ({
      phase,
      day,
      playing,
      seed,
      revision,
      cells: [...cells],
      reservations
    }));
    return () => {
      dead = true;
      uninstall();
      playing = false;
      attachMap(null);
      client?.dispose();
      client = null;
      handle = null;
      layers = null;
    };
  });
</script>

{#snippet headerActions()}
  {#each [{ label: 'Timeline', open: openTimeline }, { label: 'Evidence', open: () => openEvidence() }] as a (a.label)}
    <button
      type="button"
      aria-haspopup="dialog"
      onclick={a.open}
      class="min-h-6 min-w-6 rounded-md border border-gray-300 px-2 text-sm font-medium whitespace-nowrap dark:border-gray-600 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >{a.label}</button
    >
  {/each}
{/snippet}

{#snippet details()}
  <DetailsPanel {summary} {day} onevidence={() => openEvidence()} />
{/snippet}

{#snippet headline()}
  <HeadlineBar {summary} panel={details} />
{/snippet}

<div class="relative h-full" style:--lc-scrubber-h="{scrubberH + noticeH}px">
  <SimMap
    {manifest}
    onRetryChunks={() => client?.retryChunks()}
    onready={onMapReady}
    view={HIDDEN_VIEW}
    timelinePick={onPick}
  />

  {#if cardOpen}
    <LessCarsCard {card} loading={cardLoading} onclose={closeCard} />
  {/if}

  <!-- The notices sit just above the scrubber; their height joins the scrubber's in the map's
       bottom inset, so the map controls and the card stay clear of them. -->
  <div
    class="pointer-events-none absolute inset-x-0 z-20 flex flex-col items-center px-4"
    style:bottom="{scrubberH}px"
    data-testid="lc-notices"
    bind:offsetHeight={noticeH}
  >
    <div role="status" class="max-w-full">
      {#if phase === 'loading'}
        <span class="mb-2 block rounded-lg bg-white px-3 py-2 text-sm text-black shadow"
          >Loading the buildings…</span
        >
      {/if}
    </div>
    {#if phase === 'failed'}
      <div
        role="alert"
        class="pointer-events-auto mb-2 flex w-max max-w-full items-center gap-1 rounded-lg bg-white py-1 pl-3 text-sm text-black shadow"
      >
        <span>Couldn't load the buildings.</span>
        <button
          type="button"
          class="min-h-11 min-w-11 rounded-lg px-3 font-semibold underline"
          onclick={retry}>Retry</button
        >
      </div>
    {/if}
  </div>

  <div class="absolute inset-x-0 bottom-0 z-20" bind:this={scrubberBox}>
    <TimeScrubber
      asOf={LESSCARS_START}
      horizon={LESSCARS_HORIZON}
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

  <TimelineDialog bind:this={timelineDialog} {plan} {day} onevidence={(id) => openEvidence(id)} />
  <EvidenceDialog bind:this={evidenceDialog} {plan} {summary} />
</div>
