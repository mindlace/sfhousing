<!--
  The timelapse map key (spec §4.5 item 11): one row per `TIMELINE_LEGEND` entry, the entry's label
  verbatim, drawn from its tokens through the `--map-*` custom properties. Those are set on
  `.sim-map` only, so FzpScoreboard injects `timelineTokenCss('.sfh-fzp-legend')` into <head>
  once; this component only reads them.
-->
<script lang="ts">
  import { TIMELINE_LEGEND } from '$lib/map/palette';

  interface Props {
    /** The initial state; the viewer can toggle it. */
    open: boolean;
  }
  let { open }: Props = $props();
  // The prop seeds the state; after that the viewer's toggle wins.
  // svelte-ignore state_referenced_locally
  let isOpen = $state(open);

  /** palette.ts's own rule for a token's custom property (copied: palette.ts is not edited). */
  const prop = (name: string) => `--map-${name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`;
  const color = (name: string) => `var(${prop(name)})`;

  function barBackground(tokens: string[]): string {
    return tokens.length === 1
      ? color(tokens[0])
      : `linear-gradient(to right, ${tokens.map(color).join(', ')})`;
  }
</script>

<details class="sfh-fzp-legend mt-3" bind:open={isOpen}>
  <summary class="min-h-6 cursor-pointer text-sm font-semibold pointer-coarse:min-h-11"
    >Map key</summary
  >
  <ul class="mt-2 space-y-1.5 text-sm">
    {#each TIMELINE_LEGEND as entry (entry.id)}
      <li class="flex items-center gap-2" data-legend={entry.id}>
        <span class="flex shrink-0 gap-px" aria-hidden="true" data-swatch={entry.id}>
          {#if entry.kind === 'ghost'}
            {#each entry.tokens as token (token)}
              <span
                class="inline-block h-4 w-7 rounded-sm border-2"
                data-token={token}
                style:background="color-mix(in srgb, {color(token)} 40%, transparent)"
                style:border-color={color(token)}
              ></span>
            {/each}
          {:else if entry.kind === 'solid'}
            {#each entry.tokens as token (token)}
              <span
                class="inline-block h-4 w-4 first:rounded-l-sm last:rounded-r-sm"
                data-token={token}
                style:background={color(token)}
              ></span>
            {/each}
          {:else}
            <span
              class="inline-block h-2 w-7 rounded-sm border"
              data-token={entry.tokens.join(' ')}
              style:background={barBackground(entry.tokens)}
              style:border-color={color('tl-bar-edge')}
            ></span>
          {/if}
        </span>
        <span>{entry.label}</span>
      </li>
    {/each}
    <li class="pl-9">Bar length: progress through the stages.</li>
  </ul>
</details>
