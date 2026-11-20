<!--
  One map key swatch, drawn from its tokens through the `--map-*` custom properties (set on
  `.sfh-map-key` by MapKeyControl, `timelineTokenCss`). Decorative: the row's words carry the
  meaning, so it is aria-hidden. Ghost: a tinted outline per token; solid: filled squares; bar: a
  stage bar (a gradient for several tokens); ring: an outlined circle (several overlap in a row);
  mark: a diamond inside a ring of its token.
-->
<script lang="ts">
  import type { Swatch } from './rows';

  interface Props {
    swatch: Swatch;
  }
  let { swatch }: Props = $props();

  /** palette.ts's own rule for a token's custom property. */
  const prop = (name: string) => `--map-${name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`;
  const color = (name: string) => `var(${prop(name)})`;

  function barBackground(tokens: string[]): string {
    return tokens.length === 1
      ? color(tokens[0])
      : `linear-gradient(to right, ${tokens.map(color).join(', ')})`;
  }
</script>

<span
  class="flex w-7 shrink-0 items-center justify-center gap-px"
  aria-hidden="true"
  data-swatch={swatch.kind}
>
  {#if swatch.kind === 'ghost'}
    {#each swatch.tokens as token (token)}
      <span
        class="inline-block h-4 w-7 rounded-sm border-2"
        data-token={token}
        style:background="color-mix(in srgb, {color(token)} 40%, transparent)"
        style:border-color={color(token)}
      ></span>
    {/each}
  {:else if swatch.kind === 'solid'}
    <span class="flex">
      {#each swatch.tokens as token (token)}
        <span
          class="inline-block h-4 first:rounded-l-sm last:rounded-r-sm {swatch.tokens.length > 2
            ? 'w-1'
            : 'w-3.5'}"
          data-token={token}
          style:background={color(token)}
        ></span>
      {/each}
    </span>
  {:else if swatch.kind === 'bar'}
    <span
      class="inline-block h-2 w-7 rounded-sm border"
      data-token={swatch.tokens.join(' ')}
      style:background={barBackground(swatch.tokens)}
      style:border-color={color('tl-bar-edge')}
    ></span>
  {:else if swatch.kind === 'ring'}
    <!-- One ring, or several overlapping in a row that fits the swatch's width. -->
    <span class="flex">
      {#each swatch.tokens as token (token)}
        <span
          class="inline-block shrink-0 rounded-full border-2 {swatch.tokens.length > 1
            ? 'h-3 w-3 not-first:-ml-1'
            : 'h-4 w-4'}"
          data-token={token}
          style:border-color={color(token)}
        ></span>
      {/each}
    </span>
  {:else}
    <!-- A diamond inside a ring of the same token, as a mark sits on its project's ring. -->
    {#each swatch.tokens as token (token)}
      <span
        class="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2"
        style:border-color={color(token)}
      >
        <span
          class="inline-block h-2 w-2 rotate-45"
          data-token={token}
          style:background={color(token)}
        ></span>
      </span>
    {/each}
  {/if}
</span>
