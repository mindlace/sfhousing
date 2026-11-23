<script lang="ts">
  /** G5: the level panel, the content of the header's level cell. No props. */
  import { tick } from 'svelte';
  import { page } from '$app/state';
  import { moreBelow } from '$lib/shell/more-below';
  import { BUTTON, BUTTON_PRIMARY, BUTTON_QUIET } from '$lib/shell/ui';
  import {
    FULL_TEXT,
    STORAGE_TEXT,
    aimText,
    levelText,
    nextText,
    playedText,
    syncText
  } from './copy';
  import { gamePath, loadPage } from './navigate';
  import { roundComplete } from './progress';
  import { MAX_SAVES, SAVE_NAME_MAX } from './saves';
  import { useGame, type StoreChange } from './store.svelte';

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
  const showLevelUp = $derived(game.offer !== null && !roundComplete(game.progress));
  const sync = $derived(syncText(game.sync.state));
  const signInHref = $derived(
    `/signin?returnTo=${encodeURIComponent(page.url.pathname + page.url.search)}`
  );

  async function focusLater(id: string): Promise<void> {
    await tick();
    document.getElementById(id)?.focus();
  }

  /** The alert's words for a refused change; empty for ok. */
  function refusal(change: StoreChange): string {
    if (change.ok) return '';
    return change.reason === 'full' ? FULL_TEXT : STORAGE_TEXT;
  }

  /** Loads the current game's page, or shows why the change was refused. */
  function settle(change: StoreChange): boolean {
    error = refusal(change);
    if (change.ok) loadPage(gamePath(game.progress.level));
    return change.ok;
  }

  async function levelUp(): Promise<void> {
    error = '';
    game.levelUp();
    await tick();
    if (!showLevelUp) document.getElementById(headingId)?.focus();
  }

  function switchTo(id: string): void {
    error = '';
    open = null;
    settle(game.switchTo(id));
  }

  function newGame(): void {
    if (full) return;
    error = '';
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
    if (!renaming(id)) return;
    error = '';
    closeRename(id, (event.currentTarget as HTMLInputElement).value);
  }

  /**
   * A press on a row's Rename or Delete leaves focus where it is, so an open field closes by the
   * press's own action, without renaming. Focus moves after the action.
   */
  function keepFocus(event: MouseEvent): void {
    if (open?.kind === 'rename') event.preventDefault();
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
    if (wasCurrent) loadPage(gamePath(game.progress.level));
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
    data-testid="level-panel"
    class="flex w-80 max-w-full flex-col gap-3 text-sm"
  >
    <div class="flex flex-col gap-1">
      <h2 id={headingId} tabindex="-1" class="text-base font-semibold">
        {levelText(game.progress.level)}
      </h2>
      <p data-testid="level-aim">{aimText(game.progress)}</p>
      <p data-testid="level-next">{nextText(game.progress)}</p>
    </div>
    {#if showLevelUp}
      <button type="button" class={BUTTON_PRIMARY} onclick={levelUp}>Level up</button>
    {/if}
    {#if sync !== null}
      <p data-testid="level-sync">
        {#if game.sync.state === 'sign-in'}
          <a class={BUTTON_QUIET} href={signInHref}>{sync}</a>
        {:else}
          {sync}
        {/if}
      </p>
    {/if}
    <h3 class="font-semibold">Saved games</h3>
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
              aria-label="Name"
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
            {levelText(entry.level)} · {current ? 'Playing' : playedText(entry.savedAt, new Date())}
          </span>
          {#if asking(entry.id)}
            <p class="px-3">Delete {entry.name}?</p>
            <div class="flex flex-wrap gap-2">
              <button type="button" class={BUTTON_PRIMARY} onclick={() => confirmDelete(entry.id)}>
                Delete
              </button>
              <button
                id={cancelId(entry.id)}
                type="button"
                class={BUTTON}
                onclick={() => cancelDelete(entry.id)}
              >
                Cancel
              </button>
            </div>
          {:else if !renaming(entry.id)}
            <div class="flex flex-wrap gap-1">
              <button
                id={renameId(entry.id)}
                type="button"
                class={BUTTON_QUIET}
                aria-label="Rename {entry.name}"
                onmousedown={keepFocus}
                onclick={() => startRename(entry.id)}
              >
                Rename
              </button>
              <button
                id={deleteId(entry.id)}
                type="button"
                class={BUTTON_QUIET}
                aria-label="Delete {entry.name}"
                onmousedown={keepFocus}
                onclick={() => askDelete(entry.id)}
              >
                Delete
              </button>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    <div class="flex flex-col gap-1">
      <button id={newGameId} type="button" class={BUTTON} aria-disabled={full} onclick={newGame}>
        New game
      </button>
      {#if full}<p>{FULL_TEXT}</p>{/if}
    </div>
    <div role="alert" data-testid="level-error">{error}</div>
  </section>
{/if}
