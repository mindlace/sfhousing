<script lang="ts">
  import { onMount } from 'svelte';
  import {
    ACCOUNT_COPY,
    emailChangeSent,
    emailConfirmed,
    emailSentTo,
    emailUnconfirmed,
    removePasskeyNamed
  } from '$lib/account/account-copy';
  import { authClient } from '$lib/account/auth-client';
  import FieldError from '$lib/account/FieldError.svelte';
  import FormStatus from '$lib/account/FormStatus.svelte';
  import PasswordSection from '$lib/account/PasswordSection.svelte';
  import { BARE, BTN, HINT, INPUT, LABEL } from '$lib/account/ui';

  interface Props {
    /** `emailVerified` false: the address is shown as not confirmed, with a confirm link. */
    user: { pseudonymous: boolean; email: string; handle: string; emailVerified?: boolean };
    /** The sign-in methods switched on for this request. Only these render. */
    methods: readonly string[];
    hasGoogle: boolean;
    hasPassword: boolean;
    canRemovePassword: boolean;
    /** The account has at least one passkey (known on the server at load). */
    hasPasskey?: boolean;
    /** The account payload is still in flight (or failed to load). */
    accountLoading?: boolean;
    /** The account payload's load settled in failure: it is never arriving. */
    accountLoadFailed?: boolean;
    /** Fired after a credential write, so the host can refetch the account payload. */
    onAccountChanged?: () => void;
  }
  let {
    user,
    methods,
    hasGoogle,
    hasPassword,
    canRemovePassword,
    hasPasskey = true,
    accountLoading = false,
    accountLoadFailed = false,
    onAccountChanged
  }: Props = $props();

  // Magic link is in effect only while mail can be delivered; without it nothing here may
  // send mail (adding or changing an email).
  const withMail = $derived(methods.includes('magic-link'));
  const withPassword = $derived(methods.includes('password'));
  const withPasskey = $derived(methods.includes('passkey'));
  const withGoogle = $derived(methods.includes('google'));

  // Email (pseudonymous user adding their first email)
  let emailValue = $state('');
  let emailSent = $state(false);
  let devLink = $state<string | undefined>(undefined);
  let emailError = $state('');

  // A registered account whose address is not confirmed (a cold join from an emailed invite).
  const unconfirmed = $derived(!user.pseudonymous && user.emailVerified === false);

  async function sendVerify(e: SubmitEvent) {
    e.preventDefault();
    emailError = '';
    const res = await fetch('/api/account/email/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Confirming an existing address: the server sends to that address only.
      body: JSON.stringify({ email: unconfirmed ? user.email : emailValue })
    });
    const body = (await res.json().catch(() => null)) as {
      emailSent?: boolean;
      email?: string;
      devLink?: string;
      emailError?: string;
    } | null;
    if (res.ok && body?.emailSent) {
      emailSent = true;
      sentTo = body.email ?? emailValue;
      devLink = body.devLink;
    } else {
      emailError = body?.emailError ?? ACCOUNT_COPY.invalidEmail;
    }
  }

  // Email (registered user changing their email)
  let newEmailValue = $state('');
  let showChange = $state(false);
  let changeSent = $state(false);
  let sentTo = $state('');
  let changeError = $state('');
  let sendingChange = $state(false);

  // The email section's one status line, mounted with the section: only its text changes.
  const emailStatus = $derived(
    changeSent
      ? emailChangeSent(user.email, sentTo)
      : emailSent
        ? emailSentTo(sentTo)
        : unconfirmed
          ? emailError
          : ''
  );

  async function sendChange(e: SubmitEvent) {
    e.preventDefault();
    changeError = '';
    sendingChange = true;
    try {
      const res = await fetch('/api/account/email', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: newEmailValue })
      });
      const body = (await res.json().catch(() => null)) as {
        emailChangeSent?: boolean;
        email?: string;
        changeError?: string;
      } | null;
      if (res.ok && body?.emailChangeSent) {
        changeSent = true;
        sentTo = body.email ?? newEmailValue;
      } else {
        changeError = body?.changeError ?? ACCOUNT_COPY.invalidEmail;
      }
    } finally {
      sendingChange = false;
    }
  }

  // Passkeys (only when the passkey method is on)
  type Passkey = { id: string; name?: string | null };
  let passkeys = $state<Passkey[]>([]);
  // With no passkey on the account the list is known to be empty: nothing to fetch.
  let loading = $state(true);
  let pkMessage = $state('');
  let pkIsError = $state(false);

  async function refresh() {
    const res = await authClient.passkey.listUserPasskeys();
    passkeys = (res?.data as Passkey[] | undefined) ?? [];
    loading = false;
  }
  onMount(() => {
    if (!withPasskey) return;
    if (!hasPasskey) {
      loading = false;
      return;
    }
    void refresh();
  });

  function pkStatus(message: string, isError: boolean) {
    pkMessage = message;
    pkIsError = isError;
  }

  async function addPasskey() {
    pkStatus('', false);
    const res = await authClient.passkey.addPasskey();
    if (res && 'error' in res && res.error) {
      // Never Better-Auth's own message: one line from the copy module.
      pkStatus(ACCOUNT_COPY.passkeyAddError, true);
      return;
    }
    pkStatus(ACCOUNT_COPY.passkeyAdded, false);
    await refresh();
  }

  async function removePasskey(id: string) {
    pkStatus('', false);
    const res = await authClient.passkey.deletePasskey({ id });
    if (res && 'error' in res && res.error) {
      pkStatus(ACCOUNT_COPY.passkeyRemoveError, true);
      return;
    }
    pkStatus(ACCOUNT_COPY.passkeyRemoved, false);
    await refresh();
  }

  async function connectGoogle() {
    await authClient.linkSocial({ provider: 'google', callbackURL: '/' });
  }
</script>

<div class="flex flex-col gap-6">
  {#if withMail || !user.pseudonymous}
    <section class="flex flex-col gap-2">
      <h3 class="font-semibold">{ACCOUNT_COPY.emailHeading}</h3>
      <FormStatus
        testid="email-status"
        focus={!!emailStatus && (emailSent || changeSent)}
        tone={unconfirmed && emailError && !emailSent ? 'error' : 'info'}
        message={emailStatus}
      />
      {#if user.pseudonymous}
        {#if emailSent}
          {#if devLink}
            <a class="underline" data-testid="dev-link" href={devLink} data-sveltekit-reload
              >{ACCOUNT_COPY.devLink}</a
            >
          {/if}
          <form onsubmit={sendVerify}>
            <button type="submit" class="{BARE} self-start">{ACCOUNT_COPY.resendLink}</button>
          </form>
        {:else}
          <p class={HINT}>{ACCOUNT_COPY.emailAddPrompt}</p>
          <form class="flex flex-col gap-2" onsubmit={sendVerify}>
            <label for="email" class={LABEL}>{ACCOUNT_COPY.emailLabel}</label>
            <input
              id="email"
              name="email"
              type="email"
              class={INPUT}
              bind:value={emailValue}
              autocomplete="email"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              aria-invalid={emailError ? 'true' : undefined}
              aria-describedby={emailError ? 'email-error' : undefined}
            />
            {#if emailError}
              <FieldError id="email-error" forId="email" message={emailError} />
            {/if}
            <button type="submit" class="{BTN} self-start">{ACCOUNT_COPY.sendLink}</button>
          </form>
        {/if}
      {:else if !changeSent}
        {#if unconfirmed}
          <p>{emailUnconfirmed(user.email)}</p>
          {#if emailSent && devLink}
            <a class="underline" data-testid="dev-link" href={devLink} data-sveltekit-reload
              >{ACCOUNT_COPY.devLink}</a
            >
          {/if}
          {#if withMail}
            <form onsubmit={sendVerify}>
              <button type="submit" class="{BARE} self-start" data-testid="confirm-email"
                >{emailSent ? ACCOUNT_COPY.resendLink : ACCOUNT_COPY.sendLink}</button
              >
            </form>
          {/if}
        {:else}
          <p>{emailConfirmed(user.email)}</p>
        {/if}
        {#if !withMail}
          <!-- No mail provider: changing the address would send a link that reaches no one. -->
        {:else if !showChange}
          <button type="button" class="{BARE} self-start" onclick={() => (showChange = true)}>
            {ACCOUNT_COPY.changeEmail}
          </button>
        {:else}
          <form class="flex flex-col gap-2" onsubmit={sendChange}>
            <label for="newEmail" class={LABEL}>{ACCOUNT_COPY.newEmailLabel}</label>
            <input
              id="newEmail"
              name="email"
              type="email"
              class={INPUT}
              bind:value={newEmailValue}
              autocomplete="email"
              autocapitalize="none"
              autocorrect="off"
              spellcheck="false"
              aria-invalid={changeError ? 'true' : undefined}
              aria-describedby={changeError ? 'newEmail-error' : undefined}
            />
            {#if changeError}
              <FieldError id="newEmail-error" forId="newEmail" message={changeError} />
            {/if}
            <div class="flex items-center gap-3">
              <button type="button" class={BARE} onclick={() => (showChange = false)}>
                {ACCOUNT_COPY.cancel}
              </button>
              <button
                type="submit"
                class={BTN}
                disabled={sendingChange}
                aria-busy={sendingChange ? 'true' : undefined}>{ACCOUNT_COPY.sendLink}</button
              >
            </div>
          </form>
        {/if}
      {/if}
    </section>
  {/if}

  {#if withPassword}
    <PasswordSection
      {hasPassword}
      canRemove={canRemovePassword}
      handle={user.handle}
      hasEmail={!user.pseudonymous}
      loading={accountLoading}
      loadFailed={accountLoadFailed}
      onChanged={onAccountChanged}
    />
  {/if}

  {#if withPasskey}
    <section class="flex flex-col gap-2">
      <h3 class="font-semibold">{ACCOUNT_COPY.passkeysHeading}</h3>
      <FormStatus testid="passkey-status" tone={pkIsError ? 'error' : 'info'} message={pkMessage} />
      <p class={HINT}>{ACCOUNT_COPY.passkeysDescription}</p>

      {#if loading}
        <p role="status">{ACCOUNT_COPY.loading}</p>
      {:else if passkeys.length === 0}
        <p>{ACCOUNT_COPY.noPasskeys}</p>
      {:else}
        <ul class="flex flex-col gap-2">
          {#each passkeys as pk (pk.id)}
            <li class="flex items-center justify-between gap-3">
              <span>{pk.name ?? ACCOUNT_COPY.passkeyDefaultName}</span>
              <button
                type="button"
                class={BARE}
                aria-label={removePasskeyNamed(pk.name ?? ACCOUNT_COPY.passkeyDefaultName)}
                onclick={() => removePasskey(pk.id)}>{ACCOUNT_COPY.remove}</button
              >
            </li>
          {/each}
        </ul>
      {/if}

      <button type="button" class="{BTN} self-start" onclick={addPasskey}
        >{ACCOUNT_COPY.passkeyAdd}</button
      >
    </section>
  {/if}

  {#if withGoogle}
    <section class="flex flex-col gap-2">
      <h3 class="font-semibold">{ACCOUNT_COPY.googleHeading}</h3>
      {#if hasGoogle}
        <p>{ACCOUNT_COPY.googleConnected}</p>
      {:else}
        <p class={HINT}>{ACCOUNT_COPY.googleConnectPrompt}</p>
        <button type="button" class="{BTN} self-start" onclick={connectGoogle}
          >{ACCOUNT_COPY.googleConnect}</button
        >
      {/if}
    </section>
  {/if}
</div>
