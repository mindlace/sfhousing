<script lang="ts">
  /**
   * S3: the account offer. No props. Reads the root layout's `user` from `page.data`, and
   * `useGame().sync.account`. It never blocks levelling up.
   */
  import { tick } from 'svelte';
  import { page } from '$app/state';
  import { currentUser } from '$lib/account/current-user.svelte';
  import { BUTTON, BUTTON_QUIET } from '$lib/shell/ui';
  import { syncText } from './copy';
  import { useGame } from './store.svelte';

  const game = useGame();
  const uid = $props.id();
  const inputId = `${uid}-handle`;
  const errorId = `${uid}-error`;

  let value = $state('');
  let busy = $state(false);
  let error = $state('');
  /** The handle just saved, held until the pull's answer sets the account. */
  let savedHandle = $state<string | null>(null);
  let announce = $state('');
  let input = $state<HTMLInputElement | null>(null);

  const user = $derived(currentUser.overlay(page.data.user ?? null));
  const account = $derived(game.sync.account);
  const handle = $derived(savedHandle ?? user?.handle ?? account?.handle ?? '');
  const claimed = $derived(
    savedHandle !== null || (account === null ? user !== null : account.handleClaimed)
  );
  const hasEmail = $derived(user !== null && !user.pseudonymous);
  const signInHref = $derived(
    `/signin?returnTo=${encodeURIComponent(page.url.pathname + page.url.search)}`
  );
  const trimmed = $derived(value.trim());

  async function fail(text: string, focus: boolean): Promise<void> {
    error = text;
    if (!focus) return;
    await tick();
    input?.focus();
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy || trimmed === '') return;
    busy = true;
    error = '';
    try {
      const response = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: trimmed })
      });
      if (response.ok) {
        const body = (await response.json().catch(() => ({}))) as { handle?: unknown };
        const saved = typeof body.handle === 'string' ? body.handle : trimmed;
        if (user) currentUser.apply(user.id, { handle: saved });
        savedHandle = saved;
        announce = 'Saved.';
        void game.sync.pull();
      } else if (response.status === 400 || response.status === 429) {
        const body = (await response.json().catch(() => ({}))) as { error?: unknown };
        await fail(typeof body.error === 'string' ? body.error : "Couldn't save. Try again.", true);
      } else if (response.status === 401) {
        await fail('Sign in first.', false);
      } else {
        await fail("Couldn't save. Try again.", false);
      }
    } catch {
      await fail("Couldn't reach the server. Check your connection.", false);
    } finally {
      busy = false;
    }
  }
</script>

{#if !game.open}
  <div class="flex flex-col gap-1 text-sm" data-testid="account-offer">
    {#if game.sync.state === 'sign-in'}
      <a class="{BUTTON_QUIET} self-start" href={signInHref}>{syncText('sign-in')}</a>
    {:else if !claimed && (user !== null || account !== null)}
      <form class="flex flex-col gap-1" onsubmit={save}>
        <label for={inputId} class="font-semibold">Save as</label>
        <div class="flex items-center gap-1">
          <span aria-hidden="true">@</span>
          <input
            id={inputId}
            bind:this={input}
            bind:value
            type="text"
            autocomplete="off"
            placeholder={handle}
            aria-invalid={error !== '' ? 'true' : undefined}
            aria-describedby={error !== '' ? errorId : undefined}
            class="min-h-6 min-w-6 flex-1 rounded-md border border-control-line bg-surface px-2 text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark dark:focus-visible:outline-accent-dark"
          />
          <button
            type="submit"
            class={BUTTON}
            disabled={trimmed === '' || busy}
            aria-busy={busy ? 'true' : undefined}
          >
            Save
          </button>
        </div>
        {#if error !== ''}<p id={errorId}>{error}</p>{/if}
      </form>
    {:else if claimed}
      <a class="{BUTTON_QUIET} self-start" href="/account">@{handle}</a>
      {#if !hasEmail}
        <a class="{BUTTON_QUIET} self-start" href="/account"
          >Add an email to play on another device</a
        >
      {/if}
    {:else}
      <p>{syncText('local')}</p>
    {/if}
    <div aria-live="polite" data-testid="account-offer-status">{announce}</div>
  </div>
{/if}
