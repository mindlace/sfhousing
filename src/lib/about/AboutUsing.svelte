<!--
  About, part 4: using it. Keyboard shortcuts (the Painting table, from SHORTCUTS, the list
  Paint's Shortcuts button shows; the Timeline table, from TIMELINE_SHORTCUTS) and Your plans.
  Headings at `level` and `level + 1`; colours only from --about-muted and --about-line, which the
  container sets (docs/dev/about.md).
-->
<script lang="ts">
  import { SHORTCUTS } from '$lib/brush/shortcuts';
  import { TIMELINE_SHORTCUTS } from '$lib/timeline/shortcuts';
  import { ABOUT_ID, PART_HEADING, YOUR_PLANS } from './copy';

  let { level }: { level: 2 | 3 } = $props();

  const sub = $derived(`h${level + 1}`);
  const tables = [
    { caption: 'Painting', rows: SHORTCUTS },
    { caption: 'Timeline', rows: TIMELINE_SHORTCUTS }
  ];
</script>

<section id={ABOUT_ID.using}>
  <svelte:element this={`h${level}`} class="text-lg font-semibold"
    >{PART_HEADING.using}</svelte:element
  >

  <section id={ABOUT_ID.shortcuts}>
    <svelte:element this={sub} class="mt-4 font-semibold">Keyboard shortcuts</svelte:element>
    {#each tables as t, i (t.caption)}
      <table class={['text-left', i === 0 ? 'mt-2' : 'mt-4']}>
        <caption class="pb-1 text-left text-(--about-muted)">{t.caption}</caption>
        <thead>
          <tr class="border-b border-(--about-line)">
            <th scope="col" class="pr-4 pb-1">Key</th>
            <th scope="col" class="pb-1">Action</th>
          </tr>
        </thead>
        <tbody>
          {#each t.rows as s (`${s.keys} ${s.action}`)}
            <tr><td class="py-1 pr-4 font-mono">{s.keys}</td><td class="py-1">{s.action}</td></tr>
          {/each}
        </tbody>
      </table>
    {/each}
  </section>

  <svelte:element this={sub} class="mt-4 font-semibold">Your plans</svelte:element>
  {#each YOUR_PLANS as line (line)}
    <p class="mt-2">{line}</p>
  {/each}
</section>
