<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import FieldError from '$lib/account/FieldError.svelte';
  import InvitationsList from '$lib/members/InvitationsList.svelte';
  import { SIMS_COPY, SIM_TITLE_MAX } from '$lib/members/copy';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
  <title>{SIMS_COPY.heading}</title>
</svelte:head>

<div class="mx-auto max-w-xl px-4 py-8">
  <h1 class="mb-4 text-2xl font-semibold">{SIMS_COPY.heading}</h1>

  <InvitationsList
    invitations={data.invitations}
    onaccepted={(simId) => goto(`/sims/${simId}`, { invalidateAll: true })}
  />

  <form method="POST" action="?/create" use:enhance class="mb-6 flex flex-wrap items-end gap-2">
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <label for="sim-title" class="text-sm font-medium">{SIMS_COPY.titleLabel}</label>
      <input
        id="sim-title"
        name="title"
        type="text"
        required
        maxlength={SIM_TITLE_MAX}
        autocomplete="off"
        class="rounded border border-current/40 bg-transparent px-3 py-2"
        aria-invalid={form?.error ? 'true' : undefined}
        aria-describedby={form?.error ? 'sim-title-error' : undefined}
      />
      <FieldError id="sim-title-error" forId="sim-title" message={form?.error ?? null} />
    </div>
    <button type="submit" class="rounded border border-current px-4 py-2 font-medium">
      {SIMS_COPY.create}
    </button>
  </form>

  {#if data.sims.length > 0}
    <ul class="space-y-1">
      {#each data.sims as sim (sim.simId)}
        <li><a class="underline" href={`/sims/${sim.simId}`}>{sim.title}</a></li>
      {/each}
    </ul>
  {/if}
</div>
