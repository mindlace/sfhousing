<!--
  Wraps a section's editing controls: during a run (`policyReadonly().on`) a disabled fieldset,
  so every control stays readable, is skipped by focus and is described by the pane's
  "read-only during a run" line. `display: contents` leaves the layout alone.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { policyReadonly } from './policy-readonly';

  let { children }: { children: Snippet } = $props();
  const ro = policyReadonly();
</script>

<fieldset disabled={ro.on} aria-describedby={ro.on ? ro.noteId : undefined} class="contents">
  {@render children()}
</fieldset>
