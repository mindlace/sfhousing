import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import GameHeaderHost from './test/GameHeaderHost.svelte';
import { quietSync, seededGame } from './test/seeded-game';

describe('SiteHeader on the server', () => {
  it('before mount: the name, no game panel, no steps, the account from user only', () => {
    const { game } = seededGame({ sync: quietSync({ handle: 'ada', handleClaimed: true }) });
    const { body } = render(GameHeaderHost, { props: { game, routeId: '/' } });
    expect(body).toMatch(/>SF Housing<\/a>/);
    expect(body).not.toContain('Simulator');
    expect(body).not.toContain('href="/sim"');
    expect(body).not.toContain('aria-label="Steps"');
    expect(body).not.toContain('data-testid="game-panel"');
    expect(body).toContain('Sign in');
    expect(body).not.toContain('@ada');
  });
});
