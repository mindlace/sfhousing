<script lang="ts">
  import { untrack } from 'svelte';
  import { ACCOUNT_COPY } from '$lib/account/account-copy';
  import { currentUser } from '$lib/account/current-user.svelte';
  import FieldError from '$lib/account/FieldError.svelte';
  import FormStatus from '$lib/account/FormStatus.svelte';
  import { BTN, HINT, INPUT, LABEL } from '$lib/account/ui';

  interface Props {
    user: { id: string; handle: string; name?: string | null };
  }
  let { user }: Props = $props();

  let handleValue = $state(untrack(() => user.handle));
  let nameValue = $state(untrack(() => user.name ?? ''));
  let error = $state('');
  let saved = $state(false);
  let submitting = $state(false);

  async function save(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    saved = false;
    submitting = true;
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: handleValue, name: nameValue })
      });
      if (res.ok) {
        saved = true;
        // Record the server's own stored values (handle case-folded, name trimmed) so the
        // header shows the change at once, with no page-data reload.
        const body = (await res.json().catch(() => null)) as {
          handle?: string;
          name?: string;
        } | null;
        currentUser.apply(user.id, { handle: body?.handle, name: body?.name });
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        error = body?.error ?? ACCOUNT_COPY.saveError;
      }
    } catch {
      error = ACCOUNT_COPY.saveError;
    } finally {
      submitting = false;
    }
  }
</script>

<div class="flex flex-col gap-2">
  <FormStatus message={saved ? ACCOUNT_COPY.saved : ''} />
  <form class="flex flex-col gap-2" onsubmit={save}>
    <label for="handle" class={LABEL}>{ACCOUNT_COPY.handleLabel}</label>
    <div class="flex items-center gap-1">
      <span aria-hidden="true">@</span>
      <input
        id="handle"
        name="handle"
        class="{INPUT} min-w-0 flex-1"
        bind:value={handleValue}
        autocomplete="username"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'handle-error' : 'handle-hint'}
      />
    </div>
    <p id="handle-hint" class={HINT}>{ACCOUNT_COPY.handleHint}</p>

    <label for="name" class={LABEL}>{ACCOUNT_COPY.displayNameLabel}</label>
    <input
      id="name"
      name="name"
      class={INPUT}
      bind:value={nameValue}
      maxlength="60"
      autocomplete="name"
    />
    <p class={HINT}>{ACCOUNT_COPY.displayNameHint}</p>

    {#if error}<FieldError id="handle-error" forId="handle" message={error} />{/if}
    <button
      type="submit"
      class="{BTN} self-start"
      disabled={submitting}
      aria-busy={submitting ? 'true' : undefined}>{ACCOUNT_COPY.save}</button
    >
  </form>
</div>
