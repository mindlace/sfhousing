<script lang="ts">
  /** The game panel, in place in the header Menu: saved games, New game and the sync line. */
  import { tick } from 'svelte';
  import { page } from '$app/state';
  import { moreBelow } from '$lib/shell/more-below';
  import { BUTTON, BUTTON_PRIMARY, BUTTON_QUIET } from '$lib/shell/ui';
  import { MAX_SAVES, SAVE_NAME_MAX } from '../saves';
  import { useGame, type StoreChange } from '../store.svelte';
  import { FULL_TEXT, STORAGE_TEXT, playedText, syncText } from '../words';
  import { reloadGame } from './reload';
  import {
    CANCEL,
    DELETE,
    NAME_LABEL,
    NEW_GAME_LABEL,
    PLAYING,
    RENAME,
    SAVED_GAMES,
    deleteAsk,
    deleteName,
    entryStage,
    renameName
  } from './words';

  const game = useGame();
  const uid = $props.id();
  const headingId = `${uid}-heading`;
  const newGameId = `${uid}-new`;
  const renameId = (id: string) => `${uid}-rename-${id}`;
  const deleteId = (id: string) => `${uid}-delete-${id}`;
  const cancelId = (id: string) => `${uid}-cancel-${id}`;
  const fieldId = (id: string) => `${uid}-field-${id}`;

  /** The one row action open now. */
  let open = $state<{ id: string; kind: 'rename' | 'delete' } | null>(null);
  let error = $state('');

  const full = $derived(game.saves.length >= MAX_SAVES);
  const sync = $derived(syncText(game.sync.state));
  const signInHref = $derived(
    `/signin?returnTo=${encodeURIComponent(page.url.pathname + page.url.search)}`
  );
  const currentName = $derived(game.saves.find((e) => e.id === game.currentId)?.name ?? '');
  const stage = $derived(entryStage(game.state.phase, game.state.rung));

  async function focusLater(id: string): Promise<void> {
    await tick();
    document.getElementById(id)?.focus();
  }

  /** The alert's words for a refused change; empty for ok. */
  function refusal(change: StoreChange): string {
    if (change.ok) return '';
    return change.reason === 'full' ? FULL_TEXT : STORAGE_TEXT;
  }

  /** Reloads '/' for the current game, or shows why the change was refused. */
  function settle(change: StoreChange): boolean {
    error = refusal(change);
    if (change.ok) reloadGame();
    return change.ok;
  }

  /**
   * Renames from the open field, as focus leaving it would, and closes it. Presses keep focus in
   * the field (`keepFocus`), so an action other than Rename or Delete commits it here.
   */
  function commitOpenRename(): void {
    if (open?.kind !== 'rename') return;
    const id = open.id;
    const field = document.getElementById(fieldId(id));
    open = null;
    if (field instanceof HTMLInputElement) game.rename(id, field.value);
  }

  function switchTo(id: string): void {
    error = '';
    commitOpenRename();
    open = null;
    settle(game.switchTo(id));
  }

  function newGame(): void {
    if (full) return;
    error = '';
    commitOpenRename();
    open = null;
    settle(game.newGame());
  }

  async function startRename(id: string): Promise<void> {
    error = '';
    open = { id, kind: 'rename' };
    await tick();
    const field = document.getElementById(fieldId(id));
    if (field instanceof HTMLInputElement) {
      field.focus();
      field.select();
    }
  }

  function renaming(id: string): boolean {
    return open !== null && open.id === id && open.kind === 'rename';
  }

  /** Closes the field once; renames when `value` is given. */
  function closeRename(id: string, value: string | null): void {
    if (!renaming(id)) return;
    error = '';
    open = null;
    if (value !== null) game.rename(id, value);
    void focusLater(renameId(id));
  }

  function onFieldKeydown(event: KeyboardEvent, id: string): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      closeRename(id, (event.currentTarget as HTMLInputElement).value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeRename(id, null);
    }
  }

  function onFieldBlur(event: FocusEvent, id: string): void {
    closeRename(id, (event.currentTarget as HTMLInputElement).value);
  }

  /**
   * While a field is open, a press on any of the panel's controls leaves focus in the field: a blur
   * would close it and move the rows under the pointer before the click. The press's own action
   * then closes the field: Rename and Delete without renaming, every other action renaming first.
   */
  function keepFocus(event: MouseEvent): void {
    if (open?.kind !== 'rename') return;
    const target = event.target;
    if (target instanceof Element && target.closest('button, a')) event.preventDefault();
  }

  function asking(id: string): boolean {
    return open !== null && open.id === id && open.kind === 'delete';
  }

  function askDelete(id: string): void {
    error = '';
    open = { id, kind: 'delete' };
    void focusLater(cancelId(id));
  }

  function cancelDelete(id: string): void {
    error = '';
    open = null;
    void focusLater(deleteId(id));
  }

  function confirmDelete(id: string): void {
    error = '';
    const wasCurrent = id === game.currentId;
    const change = game.remove(id);
    if (!change.ok) {
      error = refusal(change);
      return;
    }
    open = null;
    if (wasCurrent) reloadGame();
    else void focusLater(newGameId);
  }

  function onRowKeydown(event: KeyboardEvent, id: string): void {
    if (event.key !== 'Escape' || !asking(id)) return;
    event.preventDefault();
    event.stopPropagation();
    cancelDelete(id);
  }
</script>

{#if !game.open}
  <section
    aria-labelledby={headingId}
    data-testid="game-panel"
    data-header-keep-open
    class="flex max-w-full flex-col gap-3 text-sm"
    onmousedowncapture={keepFocus}
  >
    <div class="flex flex-col gap-1">
      <h2 id={headingId} tabindex="-1" class="text-base font-semibold">{currentName}</h2>
      <p data-testid="game-stage">{stage}</p>
    </div>
    {#if sync !== null}
      <p data-testid="game-sync">
        {#if game.sync.state === 'sign-in'}
          <a class={BUTTON_QUIET} href={signInHref} onclick={commitOpenRename}>{sync}</a>
        {:else}
          {sync}
        {/if}
      </p>
    {/if}
    <h3 class="font-semibold">{SAVED_GAMES}</h3>
    <ul class="more-below flex max-h-64 flex-col gap-2 overflow-y-auto" {@attach moreBelow}>
      {#each game.saves as entry (entry.id)}
        {@const current = entry.id === game.currentId}
        <!-- Escape is handled while focus is inside a row's delete question. -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <li
          data-testid="save-row"
          aria-current={current ? 'true' : undefined}
          class="flex flex-col gap-1"
          onkeydown={(event) => onRowKeydown(event, entry.id)}
        >
          {#if renaming(entry.id)}
            <input
              id={fieldId(entry.id)}
              type="text"
              aria-label={NAME_LABEL}
              maxlength={SAVE_NAME_MAX}
              value={entry.name}
              autocomplete="off"
              class="min-h-6 min-w-6 rounded-md border border-control-line bg-surface px-2 text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent dark:border-control-line-dark dark:bg-surface-dark dark:text-ink-dark dark:focus-visible:outline-accent-dark"
              onkeydown={(event) => onFieldKeydown(event, entry.id)}
              onblur={(event) => onFieldBlur(event, entry.id)}
            />
          {:else if current}
            <span class="px-3 font-semibold">{entry.name}</span>
          {:else}
            <button
              type="button"
              class="{BUTTON_QUIET} self-start text-left"
              onclick={() => switchTo(entry.id)}
            >
              {entry.name}
            </button>
          {/if}
          <span class="px-3">
            {entryStage(entry.phase, entry.rung)} · {current
              ? PLAYING
              : playedText(entry.savedAt, new Date())}
          </span>
          {#if asking(entry.id)}
            <p class="px-3">{deleteAsk(entry.name)}</p>
            <div class="flex flex-wrap gap-2">
              <button type="button" class={BUTTON_PRIMARY} onclick={() => confirmDelete(entry.id)}>
                {DELETE}
              </button>
              <button
                id={cancelId(entry.id)}
                type="button"
                class={BUTTON}
                onclick={() => cancelDelete(entry.id)}
              >
                {CANCEL}
              </button>
            </div>
          {:else if !renaming(entry.id)}
            <div class="flex flex-wrap gap-1">
              <button
                id={renameId(entry.id)}
                type="button"
                class={BUTTON_QUIET}
                aria-label={renameName(entry.name)}
                onclick={() => startRename(entry.id)}
              >
                {RENAME}
              </button>
              <button
                id={deleteId(entry.id)}
                type="button"
                class={BUTTON_QUIET}
                aria-label={deleteName(entry.name)}
                onclick={() => askDelete(entry.id)}
              >
                {DELETE}
              </button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="flex flex-col gap-1">
      <button id={newGameId} type="button" class={BUTTON} aria-disabled={full} onclick={newGame}>
        {NEW_GAME_LABEL}
      </button>
      {#if full}<p>{FULL_TEXT}</p>{/if}
    </div>
    <div role="alert" data-testid="game-error">{error}</div>
  </section>
{/if}
