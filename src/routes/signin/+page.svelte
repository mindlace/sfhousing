<script lang="ts">
  import { page } from '$app/state';
  import { enhance } from '$app/forms';
  import { authClient } from '$lib/account/auth-client';
  import { AUTH_COPY, pendingSimLine } from '$lib/account/copy';
  import FieldError from '$lib/account/FieldError.svelte';
  import FormStatus from '$lib/account/FormStatus.svelte';
  import { safeReturnTo } from '$lib/account/safe-redirect';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const returnTo = safeReturnTo(page.url.searchParams.get('returnTo'));
  // A form action URL replaces the page's query, so carry returnTo on it: the actions read it
  // to land the visitor back where they were headed (the pending-sim resume is at /sims).
  const keep = returnTo === '/' ? '' : `&returnTo=${encodeURIComponent(returnTo)}`;
  // Arrived with ?signup=1: email only, no passkey, no handle.
  const signingUp = $derived(!!data.signup);
  const hasPassword = $derived(data.methods.includes('password'));
  const hasPasskey = $derived(data.methods.includes('passkey'));
  const hasGoogle = $derived(data.methods.includes('google'));

  let busy = $state<null | 'link' | 'google' | 'passkey' | 'password'>(null);
  let passkeyFailed = $state(false);

  // The reveal is a $derived, not a mirrored $state: a failed password submit re-renders
  // this page with a fresh `form`, which would reset a plain local toggle and hide the
  // very field the error is about. Deriving keeps it open whenever the server came back
  // with ANY error while in password mode, not just signinFailed: on the no-JS full-page
  // POST path (use:enhance never runs, so toggledPassword is reset to its initial value) a
  // 429 is just as reachable as the generic sign-in failure, and narrowing to one message
  // would collapse the field and orphan its own error. `passwordCollapsed` is the explicit
  // "went back" override, set only by the Cancel button below, so a user who deliberately
  // backs out of password mode stays out even though `form?.error` is still sitting on a
  // stale response.
  let toggledPassword = $state(false);
  let passwordCollapsed = $state(false);
  let passwordValue = $state('');
  const usingPassword = $derived(
    hasPassword && !passwordCollapsed && (toggledPassword || (!signingUp && !!form?.error))
  );

  async function passkeySignIn() {
    busy = 'passkey';
    passkeyFailed = false;
    try {
      const res = await authClient.signIn.passkey();
      if (res && 'error' in res && res.error) {
        passkeyFailed = true;
        busy = null;
        return;
      }
      window.location.href = returnTo;
    } catch {
      passkeyFailed = true;
      busy = null;
    }
  }

  function googleSignIn() {
    busy = 'google';
    authClient.signIn.social({
      provider: 'google',
      callbackURL: returnTo,
      // The Google provider sets disableImplicitSignUp; this flag keeps /signin creating an
      // account on first Google sign-in.
      requestSignUp: true,
      // Better-Auth appends ?error=<code> on failure; the load collapses it to a
      // friendly message. returnTo is intentionally not preserved on this error bounce.
      errorCallbackURL: '/signin'
    });
  }

  // One status region serves confirmation, progress, and non-field errors.
  const statusIsError = $derived(passkeyFailed || (!!data.googleError && busy === null));
  const statusText = $derived(
    form?.sent
      ? AUTH_COPY.emailSent
      : busy === 'link'
        ? AUTH_COPY.sending
        : busy === 'google'
          ? AUTH_COPY.redirectingGoogle
          : busy === 'passkey'
            ? AUTH_COPY.passkeyWaiting
            : passkeyFailed
              ? AUTH_COPY.passkeyFailed
              : data.googleError
                ? AUTH_COPY.googleError
                : ''
  );

  const btn = 'rounded border border-current px-4 py-2 font-medium disabled:opacity-60';
  const bare = 'self-start px-1 py-1 underline';
  const input = 'rounded border border-current/40 bg-transparent px-3 py-2';
</script>

<svelte:head>
  <title>{signingUp ? AUTH_COPY.pageTitleSignup : AUTH_COPY.pageTitle}</title>
</svelte:head>

<div class="mx-auto flex max-w-md flex-col gap-3 py-4">
  <h1 class="text-2xl font-semibold">{signingUp ? AUTH_COPY.signUp : AUTH_COPY.signIn}</h1>

  <FormStatus message={statusText} focus={!!form?.sent} tone={statusIsError ? 'error' : 'info'} />

  {#if data.pendingSim}
    <p>{pendingSimLine(data.pendingSim)}</p>
  {/if}

  {#if form?.sent}
    {#if form.devLink}
      <p><a class="underline" href={form.devLink} data-testid="dev-link">{AUTH_COPY.devLink}</a></p>
    {/if}
  {:else}
    {#if hasGoogle}
      <button
        type="button"
        class={btn}
        disabled={busy !== null}
        aria-busy={busy === 'google' ? 'true' : undefined}
        onclick={googleSignIn}
      >
        {AUTH_COPY.googleButton}
      </button>
    {/if}
    {#if data.reset && hasPassword}
      <p data-testid="reset-done">{AUTH_COPY.passwordResetDone}</p>
    {/if}
    <form
      method="POST"
      action={`?/sendLink${keep}`}
      class="flex flex-col gap-3"
      use:enhance={({ action }) => {
        // One form, two submits (formaction). Track which one is in flight so the
        // password button gets aria-busy and the "Sending…" link status does not fire.
        busy = action.search.startsWith('?/signInPassword') ? 'password' : 'link';
        return async ({ update }) => {
          busy = null;
          await update();
        };
      }}
    >
      <!-- The identifier is required by every method, so it leads. -->
      <label for="identifier" class="font-medium"
        >{signingUp ? AUTH_COPY.emailLabel : AUTH_COPY.identifierLabel}</label
      >
      <!-- A signInPassword failure never flags #password, only #identifier, deliberately,
           even though the identifier is not always the one that was wrong. Flagging the
           password field on a bad password would itself signal "the handle was fine",
           which is exactly the enumeration signal the generic error is meant to deny. -->
      <input
        id="identifier"
        name="identifier"
        value={data.pendingIdentifier ?? ''}
        class={input}
        autocomplete={signingUp ? 'email' : 'username'}
        placeholder={signingUp ? AUTH_COPY.emailPlaceholder : AUTH_COPY.identifierPlaceholder}
        aria-invalid={form?.error ? 'true' : undefined}
        aria-describedby={form?.error ? 'identifier-error' : undefined}
        required
      />
      {#if form?.error}
        <FieldError id="identifier-error" forId="identifier" message={form.error} />
      {/if}

      {#if !signingUp && (hasPasskey || hasPassword)}
        <p class="font-medium">{AUTH_COPY.chooseOne}</p>
        {#if hasPasskey}
          <button
            type="button"
            class={btn}
            disabled={busy !== null}
            aria-busy={busy === 'passkey' ? 'true' : undefined}
            onclick={passkeySignIn}
          >
            {AUTH_COPY.passkeyButton}
          </button>
        {/if}
        <!-- Sign-in only: there is no password SIGN-UP path in this product, so offering
             it in ?signup=1 mode would be a dead end. -->
        {#if hasPassword}
          {#if usingPassword}
            <label for="password" class="font-medium">{AUTH_COPY.passwordLabel}</label>
            <input
              id="password"
              name="password"
              class={input}
              type="password"
              autocomplete="current-password"
              bind:value={passwordValue}
              required
            />
            <div class="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                formaction={`?/signInPassword${keep}`}
                class={btn}
                data-testid="password-submit"
                disabled={busy !== null}
                aria-busy={busy === 'password' ? 'true' : undefined}
                >{AUTH_COPY.passwordSubmit}</button
              >
              <button
                type="button"
                class={bare}
                data-testid="password-cancel"
                onclick={() => {
                  toggledPassword = false;
                  passwordCollapsed = true;
                  passwordValue = '';
                }}
              >
                {AUTH_COPY.cancel}
              </button>
              <a class={bare} data-testid="forgot-password" href="/forgot-password"
                >{AUTH_COPY.forgotPassword}</a
              >
            </div>
          {:else}
            <button
              type="button"
              class={bare}
              onclick={() => {
                toggledPassword = true;
                passwordCollapsed = false;
              }}
            >
              {AUTH_COPY.usePassword}
            </button>
          {/if}
        {/if}
      {/if}
      <button
        type="submit"
        formaction={`?/sendLink${keep}`}
        class={btn}
        data-testid="sendlink-submit"
        disabled={busy !== null}
        aria-busy={busy === 'link' ? 'true' : undefined}>{AUTH_COPY.emailMeLink}</button
      >
    </form>
  {/if}

  <!-- Signed out is the only way to reach this page (load redirects a signed-in user
       away), so the escape hatch is shown unconditionally: a shared-device visitor
       deserves it even with no sim title stashed. -->
  <form method="POST" action="?/startFresh" class="flex flex-col gap-3">
    <button
      type="submit"
      id="start-fresh"
      class={bare}
      data-testid="start-fresh"
      aria-describedby={form?.startFreshError ? 'start-fresh-error' : undefined}
      >{AUTH_COPY.startFresh}</button
    >
    {#if form?.startFreshError}
      <FieldError id="start-fresh-error" forId="start-fresh" message={form.startFreshError} />
    {/if}
  </form>
</div>
