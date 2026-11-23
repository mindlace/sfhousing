import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import LevelPanel from './LevelPanel.svelte';
import WinCard from './WinCard.svelte';
import { createSaveSync } from './save-sync.svelte';
import { GameStore, openGame, provideGame, useGame } from './store.svelte';

const NI = /^not implemented$/;
const sync = () => createSaveSync({ storage: null, fetchFn: fetch, signedIn: () => false });

describe('game contract stubs', () => {
  it('the GameStore constructor throws', () => {
    expect(() => new GameStore({ storage: null, sync: sync() })).toThrowError(NI);
  });
  it('openGame throws', () => {
    expect(() => openGame()).toThrowError(NI);
  });
  it('provideGame throws', () => {
    expect(() => provideGame({} as GameStore)).toThrowError(NI);
  });
  it('useGame throws', () => {
    expect(() => useGame()).toThrowError(NI);
  });
  it('WinCard renders nothing', async () => {
    const view = await render(WinCard, {
      title: 'Room for 82,069 homes',
      unlocks: 'Permitting',
      onlevelup: () => {},
      onkeep: () => {}
    });
    expect(view.container.children.length).toBe(0);
    expect(view.container.textContent).toBe('');
  });
  it('LevelPanel renders nothing', async () => {
    const view = await render(LevelPanel);
    expect(view.container.children.length).toBe(0);
    expect(view.container.textContent).toBe('');
  });
});
