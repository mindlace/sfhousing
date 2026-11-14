import { describe, it, expect } from 'vitest';
import { CurrentUser } from './current-user.svelte';

describe('CurrentUser overlay', () => {
  it('passes a user through untouched before any write', () => {
    expect.hasAssertions();
    const cu = new CurrentUser();
    const user = { id: 'u1', handle: 'ada', name: 'Ada L' };
    expect(cu.overlay(user)).toEqual(user);
  });

  it('applies a saved handle and name over the load data', () => {
    expect.hasAssertions();
    const cu = new CurrentUser();
    cu.apply('u1', { handle: 'ada-l', name: 'Ada Lovelace' });
    expect(cu.overlay({ id: 'u1', handle: 'ada', name: 'Ada L' })).toEqual({
      id: 'u1',
      handle: 'ada-l',
      name: 'Ada Lovelace'
    });
  });

  it('applies an empty display name (clearing it is a real edit)', () => {
    expect.hasAssertions();
    const cu = new CurrentUser();
    cu.apply('u1', { name: '' });
    expect(cu.overlay({ id: 'u1', handle: 'ada', name: 'Ada L' })?.name).toBe('');
  });

  it('leaves a null user null', () => {
    expect.hasAssertions();
    const cu = new CurrentUser();
    cu.apply('u1', { handle: 'ada-l' });
    expect(cu.overlay(null)).toBeNull();
  });

  it('does not apply one identity overlay to a different identity', () => {
    expect.hasAssertions();
    const cu = new CurrentUser();
    cu.apply('u1', { handle: 'ada-l', name: 'Ada Lovelace' });
    // Sign-out is a client navigation, so this singleton survives it and the landing front
    // door mints a fresh pseudonymous account. The previous user's handle must not paint
    // onto the new one.
    const next = { id: 'u2', handle: 'wandering-wren', name: null };
    expect(cu.overlay(next)).toEqual(next);
  });

  it('a write for a new identity discards the previous identity overlay', () => {
    expect.hasAssertions();
    const cu = new CurrentUser();
    cu.apply('u1', { handle: 'ada-l', name: 'Ada Lovelace' });
    cu.apply('u2', { handle: 'wren-w' });
    expect(cu.overlay({ id: 'u2', handle: 'wandering-wren', name: 'Wandering Wren' })).toEqual({
      id: 'u2',
      handle: 'wren-w',
      name: 'Wandering Wren'
    });
    // …and the retired one no longer applies to u1 either.
    const back = { id: 'u1', handle: 'ada', name: 'Ada L' };
    expect(cu.overlay(back)).toEqual(back);
  });

  it('handleFor answers only for the identity the handle was recorded against', () => {
    expect.hasAssertions();
    const cu = new CurrentUser();
    expect(cu.handleFor('u1')).toBeNull();
    cu.apply('u1', { handle: 'ada-l' });
    expect(cu.handleFor('u1')).toBe('ada-l');
    expect(cu.handleFor('u2')).toBeNull();
    expect(cu.handleFor(null)).toBeNull();
  });
});
