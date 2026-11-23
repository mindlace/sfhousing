import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import LevelCellHost from './test/LevelCellHost.svelte';
import { quietSync, seededGame } from './test/seeded-game';

describe('SiteHeader on the server', () => {
  it("before mount a level 1 game renders today's steps, no level cell, the account from user only", () => {
    const { game } = seededGame({
      level: 1,
      sync: quietSync({ handle: 'ada', handleClaimed: true })
    });
    const { body } = render(LevelCellHost, { props: { game, routeId: '/' } });
    expect(body).toContain('href="/sim"');
    expect(body).not.toContain('data-step-locked');
    expect(body).not.toContain('data-testid="header-level"');
    expect(body).toContain('Sign in');
    expect(body).not.toContain('@ada');
  });
});
