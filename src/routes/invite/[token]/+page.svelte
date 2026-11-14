<script lang="ts">
  import { enhance } from '$app/forms';
  import { AUTH_COPY } from '$lib/account/copy';
  import FieldError from '$lib/account/FieldError.svelte';
  import FormStatus from '$lib/account/FormStatus.svelte';
  import { MEMBERS_COPY, inviteHeading } from '$lib/members/copy';
  let { data, form } = $props();

  const btn = 'rounded border border-current px-4 py-2 font-medium disabled:opacity-60';
  const bare = 'self-start px-1 py-1 underline';
  const input = 'rounded border border-current/40 bg-transparent px-3 py-2';

  let busy = $state(false);
  const withBusy = () => {
    busy = true;
    return async ({ update }: { update: () => Promise<void> }) => {
      busy = false;
      await update();
    };
  };
</script>

<svelte:head><title>{MEMBERS_COPY.invitePageTitle}</title></svelte:head>

<div class="mx-auto flex max-w-md flex-col gap-3 py-4">
  {#if !data.invite}
    <h1 class="text-2xl font-semibold">{MEMBERS_COPY.inviteInvalidTitle}</h1>
    <p>{MEMBERS_COPY.inviteInvalid}</p>
  {:else}
    <h1 class="text-2xl font-semibold">
      {inviteHeading(data.invite.inviterHandle, data.invite.simTitle)}
    </h1>
    <FormStatus message={form?.checkEmail ? MEMBERS_COPY.inviteCheckEmail : ''} focus />
    {#if form?.checkEmail}
      {#if form?.devLink}
        <p>
          <a class="underline" href={form.devLink} data-testid="dev-link">{AUTH_COPY.devLink}</a>
        </p>
      {/if}
    {:else if data.signedIn}
      <form method="POST" action="?/accept" class="flex flex-col gap-3" use:enhance={withBusy}>
        <button type="submit" class={btn} disabled={busy} aria-busy={busy ? 'true' : undefined}
          >{MEMBERS_COPY.inviteAccept}</button
        >
      </form>
    {:else}
      <form method="POST" action="?/join" class="flex flex-col gap-3" use:enhance={withBusy}>
        <label for="invite-email" class="font-medium">{MEMBERS_COPY.inviteEmailLabel}</label>
        <input
          id="invite-email"
          name="email"
          type="email"
          autocomplete="email"
          class={input}
          value={data.invite.invitedEmail ?? ''}
          aria-invalid={form?.error ? 'true' : undefined}
          aria-describedby={form?.error ? 'invite-email-error' : undefined}
        />
        <button type="submit" class={btn} disabled={busy} aria-busy={busy ? 'true' : undefined}
          >{MEMBERS_COPY.inviteJoinSim}</button
        >
        <button
          type="submit"
          name="fresh"
          value="1"
          class={bare}
          data-testid="start-fresh"
          disabled={busy}>{AUTH_COPY.startFresh}</button
        >
        {#if form?.error}
          <FieldError id="invite-email-error" forId="invite-email" message={form.error} />
        {/if}
      </form>
    {/if}
  {/if}
</div>
