<script lang="ts">
  import { untrack } from 'svelte';
  import { ACCOUNT_COPY, passwordSignInAs } from '$lib/account/account-copy';
  import FieldError from '$lib/account/FieldError.svelte';
  import FormStatus from '$lib/account/FormStatus.svelte';
  import { BARE, BTN, HINT, INPUT, LABEL } from '$lib/account/ui';

  interface Props {
    hasPassword: boolean;
    canRemove: boolean;
    handle: string;
    hasEmail: boolean;
    /** The account payload has not resolved yet: no fact below is trustworthy. */
    loading?: boolean;
    /** The account payload failed to load: it is never arriving. */
    loadFailed?: boolean;
    /** Fired after a write lands, so the host can refetch the facts this section was given. */
    onChanged?: () => void;
  }
  let {
    hasPassword,
    canRemove,
    handle,
    hasEmail,
    loading = false,
    loadFailed = false,
    onChanged
  }: Props = $props();

  let editing = $state(false);
  let value = $state('');
  let currentValue = $state('');
  let error = $state('');
  let errorField = $state<'password' | 'currentPassword'>('password');
  let saving = $state(false);
  let justSet = $state(false);
  /** The result of the last write, shown in the status line under the heading. */
  let done = $state('');
  // The pane does not refetch the account payload after a write, so the section
  // keeps a local post-write override. The PROP stays authoritative: a later
  // prop value (the async /api/account load resolving) clears the override, so
  // a stale local view can never outlive the fact it was standing in for.
  let setLocally = $state<boolean | null>(null);
  let removableLocally = $state<boolean | null>(null);
  const isSet = $derived(setLocally ?? hasPassword);
  const removable = $derived(removableLocally ?? canRemove);

  // Each override is keyed to ITS OWN prop, by VALUE: a fresh `canRemove` says
  // nothing about whether a password exists, so it must not discard `setLocally`
  // (and vice versa). Comparing values rather than trusting the effect to fire
  // per-prop also survives a host that re-passes every prop on any change: a
  // re-run carrying the same value has corrected nothing, so it clears nothing.
  // Plain variables, not $state: they are read AND written inside the effect,
  // and a reactive value doing that self-triggers forever.
  // untrack: the seed is deliberately a one-time read of the mount value.
  let seenHasPassword = untrack(() => hasPassword);
  let seenCanRemove = untrack(() => canRemove);

  $effect(() => {
    if (hasPassword === seenHasPassword) return;
    seenHasPassword = hasPassword;
    setLocally = null;
  });
  $effect(() => {
    if (canRemove === seenCanRemove) return;
    seenCanRemove = canRemove;
    removableLocally = null;
  });

  let currentInput = $state<HTMLInputElement | null>(null);
  let newInput = $state<HTMLInputElement | null>(null);
  // Deliberately NOT $state: this flag is read and written inside the focus
  // effect, and a reactive value doing that self-triggers the effect forever.
  let focusPending = false;

  function openEditor() {
    error = '';
    editing = true;
    // One-shot, armed by the OPEN, not by the input binding. Keying focus off
    // `currentInput` steals focus mid-edit if `isSet` flips true (the account
    // payload landing, or the server correcting us) and mounts that field late.
    focusPending = true;
  }

  $effect(() => {
    // The clicked button unmounts when the form opens, dropping focus to <body>.
    const first = currentInput ?? newInput;
    if (!editing || !focusPending) return;
    focusPending = false;
    first?.focus();
  });

  function fail(body: { error?: string; field?: string } | null, fallback: string) {
    error = body?.error ?? fallback;
    const blamesCurrent = body?.field === 'currentPassword';
    // The server demanding a current password IS proof that one is set, even
    // when the props we were handed (a stale account payload the host never
    // refetched) still say otherwise. Adopt the server's fact so the
    // current-password field appears and the form becomes satisfiable at all;
    // without this, every retry reissues the identical rejected request.
    if (blamesCurrent && !isSet) setLocally = true;
    // Invariant: the blamed field must be one that is actually on screen.
    // FieldError moves focus by id and the input wires `aria-describedby` only
    // for its own field, so blaming an unrendered input orphans the error from
    // assistive tech and moves no focus at all.
    errorField = blamesCurrent ? 'currentPassword' : 'password';
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    done = '';
    saving = true;
    try {
      // `currentPassword` is REQUIRED by the endpoint when a password already
      // exists: omitting it is a 400, not a silent overwrite.
      const payload = isSet
        ? { password: value, currentPassword: currentValue }
        : { password: value };
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        field?: string;
      } | null;
      if (res.ok && body?.ok) {
        const changed = isSet;
        setLocally = true;
        editing = false;
        value = '';
        currentValue = '';
        justSet = !changed;
        done = changed ? ACCOUNT_COPY.passwordChangedDone : ACCOUNT_COPY.passwordSetDone;
        // The host's account payload is now stale. Without this, remounting the
        // pane would resurrect `hasPassword: false` and offer "Set a password"
        // to someone who has one, a request the server always rejects.
        onChanged?.();
      } else {
        fail(body, ACCOUNT_COPY.passwordSetError);
      }
    } catch {
      // A network-level rejection is not an `!res.ok`: unhandled, it becomes an
      // unhandled promise rejection and, for a user setting their ONLY recovery
      // credential, silently leaves `error` empty with no feedback at all.
      fail(null, ACCOUNT_COPY.passwordNetworkError);
    } finally {
      saving = false;
    }
  }

  async function remove() {
    error = '';
    done = '';
    try {
      const res = await fetch('/api/account/password', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' }
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        field?: string;
      } | null;
      if (res.ok && body?.ok) {
        setLocally = false;
        removableLocally = false;
        justSet = false;
        done = ACCOUNT_COPY.passwordRemovedDone;
        onChanged?.();
      } else {
        // A 409 IS the last-factor guard: the button can only ever fail from here,
        // so stop offering it rather than leaving a click that cannot succeed.
        if (res.status === 409) removableLocally = false;
        fail(body, ACCOUNT_COPY.passwordSetError);
      }
    } catch {
      // See the matching catch in save().
      fail(null, ACCOUNT_COPY.passwordNetworkError);
    }
  }
</script>

<section class="flex flex-col gap-2">
  <h3 class="font-semibold">{ACCOUNT_COPY.passwordHeading}</h3>
  {#if !loading}
    <FormStatus testid="password-done" message={done} />
  {/if}
  <p class={HINT}>{ACCOUNT_COPY.passwordDescription}</p>
  <!-- The handle IS the sign-in identifier; a user who does not know it cannot sign in. -->
  <p class={HINT}>{passwordSignInAs(handle)}</p>

  {#if loading}
    <!-- Withhold every fact until the payload lands. `?? false` on the caller
         side would claim "has an email" and "has no password": both fail
         toward looking safe, which is the wrong direction for this section.
         Staying inert on failure is right, but claiming "Loading…" forever for
         something that stopped loading is a lie, so say so instead. -->
    {#if loadFailed}
      <p
        class="font-medium text-red-800 dark:text-red-300"
        role="status"
        data-testid="password-load-failed"
      >
        {ACCOUNT_COPY.loadFailed}
      </p>
    {:else}
      <p class={HINT} role="status">{ACCOUNT_COPY.loading}</p>
    {/if}
  {:else}
    {#if !hasEmail}
      <p class="font-medium text-red-800 dark:text-red-300" data-testid="password-no-recovery">
        {ACCOUNT_COPY.passwordNoRecovery}
      </p>
    {/if}

    {#if editing}
      <form class="flex flex-col gap-2" onsubmit={save}>
        {#if isSet}
          <label for="current-password" class={LABEL}>{ACCOUNT_COPY.passwordCurrentLabel}</label>
          <input
            id="current-password"
            class={INPUT}
            type="password"
            autocomplete="current-password"
            bind:value={currentValue}
            bind:this={currentInput}
            aria-invalid={error && errorField === 'currentPassword' ? 'true' : undefined}
            aria-describedby={error && errorField === 'currentPassword'
              ? 'current-password-error'
              : undefined}
            required
          />
        {/if}
        <label for="new-password" class={LABEL}>{ACCOUNT_COPY.passwordLabel}</label>
        <input
          id="new-password"
          class={INPUT}
          type="password"
          autocomplete="new-password"
          bind:value
          bind:this={newInput}
          aria-invalid={error && errorField === 'password' ? 'true' : undefined}
          aria-describedby={error && errorField === 'password' ? 'new-password-error' : undefined}
          required
        />
        {#if error}
          <!-- Bound to the field the SERVER blamed: FieldError also moves focus,
               so blaming the wrong input strands the user on a valid one. -->
          <FieldError
            id={`${errorField === 'currentPassword' ? 'current-password' : 'new-password'}-error`}
            forId={errorField === 'currentPassword' ? 'current-password' : 'new-password'}
            message={error}
          />
        {/if}
        <div class="flex items-center gap-3">
          <button
            type="button"
            class={BARE}
            onclick={() => {
              editing = false;
              // A "current password is wrong" error is rendered inside the form. Once
              // Cancel unmounts the form, the same `error` would re-render beside
              // Set/Change, detached from the field it described.
              error = '';
              errorField = 'password';
            }}
          >
            {ACCOUNT_COPY.cancel}
          </button>
          <button type="submit" class={BTN} disabled={saving}>{ACCOUNT_COPY.save}</button>
        </div>
      </form>
    {:else}
      {#if error}
        <FormStatus testid="password-error" tone="error" message={error} />
      {/if}
      <div class="flex items-center gap-3">
        <button type="button" class={BTN} onclick={openEditor}>
          {isSet ? ACCOUNT_COPY.passwordChange : ACCOUNT_COPY.passwordSet}
        </button>
        {#if isSet}
          <!-- Disabled, not enabled-then-refused: the server's 409 is the
               enforcement, this is the affordance. A disabled button is out of
               the tab order, so the reason is associated, not merely adjacent. -->
          <button
            type="button"
            class={BARE}
            disabled={!removable}
            aria-describedby={removable ? undefined : 'password-remove-reason'}
            onclick={remove}
          >
            {ACCOUNT_COPY.remove}
          </button>
        {/if}
      </div>
      {#if isSet && !removable}
        <p class={HINT} id="password-remove-reason">{ACCOUNT_COPY.passwordLastFactor}</p>
      {/if}
    {/if}
  {/if}

  {#if justSet}
    <FormStatus
      testid="password-status"
      tone="info"
      message={ACCOUNT_COPY.passwordAddRecoveryNudge}
    />
  {/if}
</section>
