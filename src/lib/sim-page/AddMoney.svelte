<!--
  "+ Add money" (funding-ui spec 4.6): a disclosure button that reveals the chooser, the
  available presets in four groups under h4 headings (City money, The public bank, State money,
  Federal money; an empty group is not shown), each with its description as visible muted text
  and as its accessible description, then "Your own pool". While `disabledReason` is set (12
  added pools, or a draft open) the toggle and every choice are aria-disabled with that reason as
  their description, and a press does nothing. A refused preset's text shows in the always-present
  `role="alert"` line. The tab closes the chooser after a choice (`open` is bindable).
-->
<script lang="ts">
  import type { FundingPreset } from './funding-presets';

  interface Props {
    presets: FundingPreset[];
    /** Why nothing can be added now, or null. */
    disabledReason: string | null;
    /** A refused preset's text (4.6 limits), or ''. */
    alert: string;
    onpreset: (p: FundingPreset) => void;
    onownpool: () => void;
    /** Whether the chooser is shown. */
    open?: boolean;
  }

  let {
    presets,
    disabledReason,
    alert,
    onpreset,
    onownpool,
    open = $bindable(false)
  }: Props = $props();

  const uid = $props.id();

  const GROUPS: { group: FundingPreset['group']; title: string }[] = [
    { group: 'city', title: 'City money' },
    { group: 'bank', title: 'The public bank' },
    { group: 'state', title: 'State money' },
    { group: 'federal', title: 'Federal money' }
  ];

  const groups = $derived(
    GROUPS.map((g) => ({
      ...g,
      items: presets.filter((p) => p.available && p.group === g.group)
    })).filter((g) => g.items.length > 0)
  );

  const off = $derived(disabledReason !== null);

  function toggle(): void {
    // A disabled toggle may still close an open chooser, never open one.
    if (off && !open) return;
    open = !open;
  }

  const muted = 'text-ink-muted dark:text-ink-dark-muted';
  const choice =
    'min-h-6 rounded-md px-1 text-left font-semibold underline aria-disabled:opacity-40 pointer-coarse:min-h-11';
</script>

<div class="flex flex-col items-start gap-1">
  <button
    type="button"
    data-funding-add
    aria-expanded={open}
    aria-controls="{uid}-chooser"
    aria-disabled={off ? 'true' : undefined}
    aria-describedby={off ? `${uid}-why` : undefined}
    class="min-h-11 rounded-md border border-control-line bg-surface px-3 font-medium text-ink hover:bg-surface-raised aria-disabled:opacity-40 dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark dark:hover:bg-surface-dark-raised"
    onclick={toggle}><span aria-hidden="true">+</span> Add money</button
  >
  {#if off}
    <span id="{uid}-why" class={muted}>{disabledReason}</span>
  {/if}
  <div id="{uid}-chooser" hidden={!open} class="flex w-full flex-col gap-2">
    {#each groups as g (g.group)}
      <section class="flex flex-col gap-1">
        <h4 class="font-semibold">{g.title}</h4>
        <ul class="flex flex-col gap-1.5">
          {#each g.items as p (p.id)}
            <li class="flex flex-col items-start">
              <button
                type="button"
                class={choice}
                aria-disabled={off ? 'true' : undefined}
                aria-describedby={off ? `${uid}-${p.id}-desc ${uid}-why` : `${uid}-${p.id}-desc`}
                onclick={() => !off && onpreset(p)}>{p.label}</button
              >
              <span id="{uid}-{p.id}-desc" class="px-1 {muted}">{p.description}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
    <div>
      <button
        type="button"
        class={choice}
        aria-disabled={off ? 'true' : undefined}
        aria-describedby={off ? `${uid}-why` : undefined}
        onclick={() => !off && onownpool()}>Your own pool</button
      >
    </div>
  </div>
  <p role="alert" class="text-red-800 dark:text-red-300 {alert ? '' : 'sr-only'}">{alert}</p>
</div>
