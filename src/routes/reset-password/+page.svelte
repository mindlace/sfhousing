<script lang="ts">
  import { enhance } from '$app/forms';
  import { AUTH_COPY } from '$lib/account/copy';
  import FieldError from '$lib/account/FieldError.svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let busy = $state(false);
  // An invalid-token bounce and a missing token are the same dead end for the user.
  const usable = $derived(!data.invalid && !!data.token);

  const btn = 'rounded border border-current px-4 py-2 font-medium disabled:opacity-60';
  const bare = 'self-start px-1 py-1 underline';
  const input = 'rounded border border-current/40 bg-transparent px-3 py-2';
</script>

<svelte:head>
  <title>{AUTH_COPY.resetTitle}</title>
</svelte:head>

<div class="mx-auto flex max-w-md flex-col gap-3 py-4">
  <h1 class="text-2xl font-semibold">{AUTH_COPY.resetHeading}</h1>

  {#if usable}
    <form
      method="POST"
      action="?/resetPassword"
      class="flex flex-col gap-3"
      use:enhance={() => {
        busy = true;
        return async ({ update }) => {
          busy = false;
          await update();
        };
      }}
    >
      <input type="hidden" name="token" value={data.token} data-testid="reset-token" />
      <label for="new-password" class="font-medium">{AUTH_COPY.resetNewLabel}</label>
      <input
        id="new-password"
        name="password"
        class={input}
        type="password"
        autocomplete="new-password"
        aria-invalid={form?.error ? 'true' : undefined}
        aria-describedby={form?.error ? 'new-password-error' : undefined}
        required
      />
      <label for="confirm-password" class="font-medium">{AUTH_COPY.resetConfirmLabel}</label>
      <input
        id="confirm-password"
        name="confirm"
        class={input}
        type="password"
        autocomplete="new-password"
        required
      />
      <FieldError id="new-password-error" forId="new-password" message={form?.error ?? null} />
      <button
        type="submit"
        class={btn}
        data-testid="reset-submit"
        disabled={busy}
        aria-busy={busy ? 'true' : undefined}>{AUTH_COPY.resetSubmit}</button
      >
    </form>
  {:else}
    <p data-testid="reset-invalid">{AUTH_COPY.resetInvalid}</p>
  {/if}

  <!-- Unconditional, not just in the {:else} branch above: `usable` is computed from
       the initial load data only, so a token that was valid on load but expires (or
       gets used up) between then and submit renders the form WITH form?.error set to
       this same invalid-link message, while `usable` stays true. Without this outside
       the form, that user has no way out. -->
  <a class={bare} href="/forgot-password">{AUTH_COPY.resetRequestAnother}</a>
</div>
