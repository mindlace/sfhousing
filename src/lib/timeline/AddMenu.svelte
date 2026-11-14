<!--
  What "+" offers on a kind (rule 12): one button per `addChoices` entry, in its order. A pick is
  handed to the Inspector, which adds it at the playhead's month (or, for "Your own pool", opens
  the pool draft). Nothing is added here.
-->
<script lang="ts">
  import type { Calibration } from '$lib/timelapse/types';
  import { addChoices, type AddOffer } from './add';
  import type { PolicyKind, SimPolicy4 } from './policy4';
  import { KIND_LABEL } from './rows';

  interface Props {
    kind: PolicyKind;
    calibration: Calibration;
    doc: SimPolicy4;
    /** A pick, with the label it was offered under. */
    onpick(choice: AddOffer, label: string): void;
  }

  let { kind, calibration, doc, onpick }: Props = $props();

  const choices = $derived(addChoices(kind, calibration, doc));
  const link =
    'min-h-6 rounded-md px-1 text-left font-semibold underline hover:bg-surface-raised dark:hover:bg-surface-dark-raised pointer-coarse:min-h-11';
</script>

<div role="group" aria-label="Add to {KIND_LABEL[kind]}" class="flex flex-col gap-1 text-sm">
  <ul class="flex flex-col items-start gap-1">
    {#each choices as c (c.label)}
      <li>
        <button type="button" class={link} onclick={() => onpick(c.choice, c.label)}
          >{c.label}</button
        >
      </li>
    {/each}
  </ul>
</div>
