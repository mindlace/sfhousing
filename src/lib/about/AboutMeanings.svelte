<!--
  About, part 1: what the numbers mean, one term each (MEANINGS, copy.ts). Its heading is at
  `level` (2 on the page, 3 in a dialog). Colours are inherited; the parts carry no theme of their
  own (docs/dev/about.md).
-->
<script lang="ts">
  import { ABOUT_ID, MEANINGS, PART_HEADING } from './copy';

  let { level }: { level: 2 | 3 } = $props();
</script>

<section id={ABOUT_ID.meanings}>
  <svelte:element this={`h${level}`} class="text-lg font-semibold"
    >{PART_HEADING.meanings}</svelte:element
  >
  <dl class="mt-3 space-y-3">
    {#each MEANINGS as m (m.term)}
      <div>
        <dt class="font-semibold">{m.term}</dt>
        <dd>
          {m.source ? `${m.body} ` : m.body}{#if m.source}<a
              class="underline"
              href={m.source.url}
              rel="noopener noreferrer">{m.source.label}</a
            >{/if}
        </dd>
      </div>
    {/each}
  </dl>
</section>
