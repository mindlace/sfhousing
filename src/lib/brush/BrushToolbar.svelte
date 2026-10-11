<script module lang="ts">
  import { TOKENS } from '$lib/map/palette';
  import { BRUSH_COLORS } from './overlay';

  const rgb = ([r, g, b]: [number, number, number]) => `rgb(${r} ${g} ${b})`;

  // Both themes' values as inline custom properties; the component styles pick one per
  // prefers-color-scheme, so the SSR frame is already themed.
  const THEME_VARS = (['light', 'dark'] as const)
    .map((t) => {
      const k = t === 'light' ? 'l' : 'd';
      return [
        `--bt-paint-${k}: ${rgb(BRUSH_COLORS[t].paint)}`,
        `--bt-erase-${k}: ${rgb(BRUSH_COLORS[t].erase)}`,
        `--bt-bg-${k}: ${TOKENS[t].land}`,
        `--bt-fg-${k}: ${TOKENS[t].label}`,
        `--bt-line-${k}: ${TOKENS[t].existing}`
      ].join('; ');
    })
    .join('; ');

  const ICONS = {
    move: [
      'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2',
      'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2',
      'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8',
      'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15'
    ],
    paint: [
      'm14.622 17.897-10.68-2.913',
      'M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z',
      'M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15'
    ],
    erase: [
      'm7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21',
      'M22 21H7',
      'm5 11 9 9'
    ],
    undo: ['M3 7v6h6', 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'],
    redo: ['M21 7v6h-6', 'M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7']
  } as const;

  const TOOLS = [
    { id: 'move', label: 'Move' },
    { id: 'paint', label: 'Paint' },
    { id: 'erase', label: 'Erase' }
  ] as const;
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import type { Editor } from './editor.svelte';
  import { MSG, radiusValueText } from './messages';
  import { STORY_PRESETS, heightHintM, posFromRadius, radiusFromPos } from './radius';
  import type { BrushTool } from './sampler';
  import { SHORTCUTS } from './shortcuts';
  import type { BrushState } from './state.svelte';

  interface Props {
    state: BrushState;
    editor: Pick<Editor, 'canUndo' | 'canRedo' | 'readOnly'>;
    onUndo(): void;
    onRedo(): void;
    onRetry(): void;
    /** The controller cancels an in-progress stroke on change. */
    onToolChange?(t: BrushTool): void;
  }

  let { state: brush, editor, onUndo, onRedo, onRetry, onToolChange }: Props = $props();

  const uid = $props.id();
  const storiesPopId = `${uid}-stories`;
  const radiusPopId = `${uid}-radius`;
  const keysId = `${uid}-keys`;

  type Pop = 'stories' | 'radius';
  let open = $state<Pop | null>(null);
  let showKeys = $state(false);
  let coarse = $state(false);
  let popEl = $state<HTMLElement>();
  let storiesOpener = $state<HTMLButtonElement>();
  let radiusOpener = $state<HTMLButtonElement>();
  const radios: Partial<Record<BrushTool, HTMLButtonElement>> = $state({});

  const enabled = (t: BrushTool) => t === 'move' || brush.phase === 'ready';
  // Roving tabindex: the checked radio, or Move when the checked one is disabled.
  const tabStop = $derived<BrushTool>(enabled(brush.tool) ? brush.tool : 'move');
  const erasing = $derived(brush.tool === 'erase');

  onMount(() => {
    try {
      coarse = matchMedia('(pointer: coarse)').matches;
    } catch {
      coarse = false;
    }
  });

  function select(t: BrushTool) {
    if (!enabled(t) || brush.tool === t) return;
    brush.tool = t;
    onToolChange?.(t);
  }

  function onRadioKey(e: KeyboardEvent, from: BrushTool) {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (dir === 0) return;
    e.preventDefault();
    const ids = TOOLS.map((t) => t.id);
    let i = ids.indexOf(from);
    for (let n = 0; n < ids.length; n++) {
      i = (i + dir + ids.length) % ids.length;
      if (enabled(ids[i])) break;
    }
    select(ids[i]);
    radios[ids[i]]?.focus();
  }

  function commitStories(el: HTMLInputElement) {
    const v = parseFloat(el.value);
    if (Number.isFinite(v)) brush.setStories(v);
    // Re-sync even when the clamped value equals the old one (80 → "85" → 80).
    el.value = String(brush.stories);
  }

  function toggle(p: Pop) {
    open = open === p ? null : p;
  }

  function opener(p: Pop) {
    return p === 'stories' ? storiesOpener : radiusOpener;
  }

  function onWindowKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || open === null) return;
    const btn = opener(open);
    open = null;
    btn?.focus();
  }

  function onWindowPointer(e: PointerEvent) {
    if (open === null) return;
    const t = e.target as Node | null;
    if (t && (popEl?.contains(t) || opener(open)?.contains(t))) return;
    open = null;
  }
</script>

<svelte:window onkeydown={onWindowKey} onpointerdown={onWindowPointer} />

{#snippet icon(paths: readonly string[])}
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    {#each paths as d (d)}<path {d} />{/each}
  </svg>
{/snippet}

{#snippet toolRadio(t: (typeof TOOLS)[number], checked: boolean)}
  <button
    bind:this={radios[t.id]}
    type="button"
    role="radio"
    aria-checked={checked}
    tabindex={t.id === tabStop || editor.readOnly ? 0 : -1}
    disabled={!enabled(t.id)}
    title={t.label}
    class="tool tool-{t.id} flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2 text-sm disabled:opacity-40 md:px-3"
    onclick={() => select(t.id)}
    onkeydown={(e) => onRadioKey(e, t.id)}
  >
    {@render icon(ICONS[t.id])}
    <span class="sr-only md:not-sr-only">{t.label}</span>
  </button>
{/snippet}

{#snippet stepper(where: string)}
  <fieldset
    disabled={erasing}
    aria-describedby={erasing ? `${uid}-${where}-hint` : undefined}
    class="flex flex-col gap-1"
  >
    <legend class="sr-only">Stories</legend>
    <div class="flex items-center gap-1">
      <button
        type="button"
        aria-label="Fewer stories"
        class="ctl min-h-11 min-w-11 rounded-md text-lg disabled:opacity-40"
        onclick={() => brush.setStories(brush.stories - 1)}>−</button
      >
      <input
        type="number"
        min="1"
        max="80"
        step="1"
        aria-label="Stories"
        aria-describedby={erasing ? `${uid}-${where}-hint` : undefined}
        value={brush.stories}
        class="field min-h-11 w-16 rounded-md text-center disabled:opacity-40"
        onblur={(e) => commitStories(e.currentTarget)}
        onkeydown={(e) => {
          if (e.key === 'Enter') commitStories(e.currentTarget);
        }}
      />
      <button
        type="button"
        aria-label="More stories"
        class="ctl min-h-11 min-w-11 rounded-md text-lg disabled:opacity-40"
        onclick={() => brush.setStories(brush.stories + 1)}>+</button
      >
      <span class="ml-1 text-sm whitespace-nowrap">stories</span>
      <span class="ml-auto text-sm whitespace-nowrap">≈ {heightHintM(brush.stories)} m</span>
    </div>
    <div class="flex flex-wrap gap-1">
      {#each STORY_PRESETS as n (n)}
        <button
          type="button"
          aria-pressed={brush.stories === n}
          aria-label="{n} stories"
          class="chip min-h-11 min-w-11 rounded-md text-sm disabled:opacity-40"
          onclick={() => brush.setStories(n)}>{n}</button
        >
      {/each}
    </div>
  </fieldset>
  {#if erasing}
    <p id="{uid}-{where}-hint" class="mt-1 text-sm">{MSG.eraseHint}</p>
  {/if}
{/snippet}

{#snippet radius(where: string)}
  <div class="flex w-full items-center gap-2">
    <label for="{uid}-{where}-radius" class="text-sm whitespace-nowrap"
      >Brush {brush.radiusM} m</label
    >
    <input
      id="{uid}-{where}-radius"
      type="range"
      min="0"
      max="99"
      step="1"
      aria-valuetext={radiusValueText(brush.radiusM)}
      value={posFromRadius(brush.radiusM)}
      class="range min-h-11 min-w-11 flex-1"
      oninput={(e) => brush.setRadius(radiusFromPos(Number(e.currentTarget.value)))}
    />
  </div>
{/snippet}

<div
  class="brush-toolbar fixed inset-x-0 bottom-[var(--scorebar-h,0px)] z-20 [--brushbar-h:56px] md:absolute md:top-4 md:right-auto md:bottom-auto md:left-4 md:w-[23rem] md:[--brushbar-h:0px]"
  style={THEME_VARS}
>
  <div
    data-testid="brush-bar"
    role="group"
    aria-label="Brush"
    class="brush-panel flex h-14 items-center gap-1 px-1 md:h-auto md:flex-col md:items-stretch md:gap-2 md:rounded-lg md:p-2"
  >
    {#if editor.readOnly}
      <div role="radiogroup" aria-label="Brush tool" class="flex gap-1">
        {@render toolRadio(TOOLS[0], true)}
      </div>
      <p class="px-2 text-sm">{MSG.readOnly}</p>
    {:else}
      <div role="radiogroup" aria-label="Brush tool" class="flex gap-1">
        {#each TOOLS as t (t.id)}
          {@render toolRadio(t, brush.tool === t.id)}
        {/each}
      </div>

      <div class="hidden md:block">{@render stepper('inline')}</div>
      <button
        bind:this={storiesOpener}
        type="button"
        aria-label="{brush.stories} stories per stroke"
        aria-expanded={open === 'stories'}
        aria-controls={storiesPopId}
        class="ctl min-h-11 min-w-11 rounded-md px-2 text-sm whitespace-nowrap md:hidden"
        onclick={() => toggle('stories')}>{brush.stories} st</button
      >
      {#if open === 'stories'}
        <div
          bind:this={popEl}
          id={storiesPopId}
          role="group"
          aria-label="Stories"
          class="brush-panel absolute inset-x-2 bottom-full z-10 mb-2 rounded-lg p-2 md:hidden"
        >
          {@render stepper('pop')}
        </div>
      {/if}

      <div class="hidden md:flex">{@render radius('inline')}</div>
      <button
        bind:this={radiusOpener}
        type="button"
        aria-label="Brush {brush.radiusM} m"
        aria-expanded={open === 'radius'}
        aria-controls={radiusPopId}
        class="ctl min-h-11 min-w-11 rounded-md px-2 text-sm whitespace-nowrap md:hidden"
        onclick={() => toggle('radius')}>{brush.radiusM} m</button
      >
      {#if open === 'radius'}
        <div
          bind:this={popEl}
          id={radiusPopId}
          role="group"
          aria-label="Brush radius"
          class="brush-panel absolute inset-x-2 bottom-full z-10 mb-2 rounded-lg p-2 md:hidden"
        >
          {@render radius('pop')}
        </div>
      {/if}

      <div class="flex items-center gap-1">
        <button
          type="button"
          aria-label="Undo (⌘Z / Ctrl+Z)"
          title="Undo (⌘Z / Ctrl+Z)"
          disabled={!editor.canUndo}
          class="ctl flex min-h-11 min-w-11 items-center justify-center rounded-md disabled:opacity-40"
          onclick={onUndo}>{@render icon(ICONS.undo)}</button
        >
        <button
          type="button"
          aria-label="Redo (⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y)"
          title="Redo (⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y)"
          disabled={!editor.canRedo}
          class="ctl flex min-h-11 min-w-11 items-center justify-center rounded-md disabled:opacity-40"
          onclick={onRedo}>{@render icon(ICONS.redo)}</button
        >
        {#if !coarse}
          <button
            type="button"
            aria-expanded={showKeys}
            aria-controls={keysId}
            class="ctl ml-auto hidden min-h-11 min-w-11 rounded-md px-2 text-sm underline md:block"
            onclick={() => (showKeys = !showKeys)}>Keyboard shortcuts</button
          >
        {/if}
      </div>
      {#if !coarse && showKeys}
        <table id={keysId} class="hidden w-full text-left text-xs md:table">
          <caption class="sr-only">Keyboard shortcuts</caption>
          <thead>
            <tr><th scope="col" class="py-1 pr-2">Key</th><th scope="col">Action</th></tr>
          </thead>
          <tbody>
            {#each SHORTCUTS as s (s.keys)}
              <tr><td class="py-1 pr-2 font-mono">{s.keys}</td><td>{s.action}</td></tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {/if}
  </div>

  {#if !editor.readOnly}
    <div
      class="pointer-events-none absolute inset-x-2 bottom-full mb-2 flex items-center gap-2 md:static md:mt-2"
    >
      <p
        role="status"
        aria-live="polite"
        class={brush.statusText ? 'brush-panel rounded-lg px-3 py-2 text-sm' : 'sr-only'}
      >
        {brush.statusText}
      </p>
      {#if brush.phase === 'failed'}
        <button
          type="button"
          class="brush-panel pointer-events-auto min-h-11 min-w-11 rounded-lg px-3 text-sm font-semibold underline"
          onclick={onRetry}>Retry</button
        >
      {/if}
    </div>
  {/if}
</div>

<style>
  .brush-toolbar {
    --brush-paint: var(--bt-paint-l);
    --brush-erase: var(--bt-erase-l);
    --bt-bg: var(--bt-bg-l);
    --bt-fg: var(--bt-fg-l);
    --bt-line: var(--bt-line-l);
    color: var(--bt-fg);
  }
  @media (prefers-color-scheme: dark) {
    .brush-toolbar {
      --brush-paint: var(--bt-paint-d);
      --brush-erase: var(--bt-erase-d);
      --bt-bg: var(--bt-bg-d);
      --bt-fg: var(--bt-fg-d);
      --bt-line: var(--bt-line-d);
    }
  }
  .brush-panel {
    background: var(--bt-bg);
    color: var(--bt-fg);
    border-top: 1px solid var(--bt-line);
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.2);
  }
  @media (min-width: 768px) {
    .brush-panel {
      border: 1px solid var(--bt-line);
    }
  }
  .tool {
    --tool-c: var(--bt-fg);
  }
  .tool-paint {
    --tool-c: var(--brush-paint);
  }
  .tool-erase {
    --tool-c: var(--brush-erase);
  }
  .tool[aria-checked='true'] {
    background: color-mix(in srgb, var(--bt-fg) 14%, transparent);
    box-shadow: inset 0 -3px 0 var(--tool-c);
    font-weight: 600;
  }
  .ctl:not(:disabled):hover,
  .tool:not(:disabled):hover,
  .chip:not(:disabled):hover {
    background: color-mix(in srgb, var(--bt-fg) 10%, transparent);
  }
  .field {
    background: transparent;
    border: 1px solid var(--bt-fg);
  }
  .chip {
    border: 1px solid var(--bt-line);
  }
  .chip[aria-pressed='true'] {
    background: var(--bt-fg);
    color: var(--bt-bg);
    border-color: var(--bt-fg);
  }
  .range {
    accent-color: var(--brush-paint);
  }
</style>
