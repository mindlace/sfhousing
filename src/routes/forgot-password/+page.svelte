<script lang="ts">
  import { enhance } from '$app/forms';
  import { AUTH_COPY } from '$lib/account/copy';
  import FieldError from '$lib/account/FieldError.svelte';
  import FormStatus from '$lib/account/FormStatus.svelte';
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();

  let busy = $state(false);

  const btn = 'rounded border border-current px-4 py-2 font-medium disabled:opacity-60';
  const bare = 'self-start px-1 py-1 underline';
  const input = 'rounded border border-current/40 bg-transparent px-3 py-2';
</script>

<svelte:head>
  <title>{AUTH_COPY.forgotTitle}</title>
</svelte:head>

<div class="mx-auto flex max-w-md flex-col gap-3 py-4">
  <h1 class="text-2xl font-semibold">{AUTH_COPY.forgotHeading}</h1>

  <!-- Deliberately identical for a real send, an unknown identifier, and a
       gate-refused account. Do not add a "we couldn't find that" branch. -->
  <FormStatus
    testid="reset-sent"
    message={form?.sent ? AUTH_COPY.forgotSent : ''}
    focus={!!form?.sent}
  />

  {#if !form?.sent}
    <p>{AUTH_COPY.forgotIntro}</p>
    <form
      method="POST"
      action="?/requestReset"
      class="flex flex-col gap-3"
      use:enhance={() => {
        busy = true;
        return async ({ update }) => {
          busy = false;
          await update();
        };
      }}
    >
      <label for="identifier" class="font-medium">{AUTH_COPY.forgotIdentifierLabel}</label>
      <input
        id="identifier"
        name="identifier"
        class={input}
        autocomplete="username"
        aria-invalid={form?.error ? 'true' : undefined}
        aria-describedby={form?.error ? 'identifier-error' : undefined}
        required
      />
      <FieldError id="identifier-error" forId="identifier" message={form?.error ?? null} />
      <button
        type="submit"
        class={btn}
        data-testid="request-reset-submit"
        disabled={busy}
        aria-busy={busy ? 'true' : undefined}>{AUTH_COPY.forgotSubmit}</button
      >
    </form>
  {/if}

  <a class={bare} href="/signin">{AUTH_COPY.backToSignin}</a>
</div>
