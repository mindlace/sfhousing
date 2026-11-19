/// <reference types="@vitest/browser-playwright" />
// The 12-word rule on `/` at rest (accessibility.md): with the Paint tab open and the header
// score showing, no visible text of 12 words or more outside a notice or a dialog. An empty plan
// (the starting sentence), and one restored stroke. Paint's Results face is not covered: its
// sentences live in the hashed ScoreboardPanel.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import './layout.css';
import type { Manifest } from '$lib/data/manifest';
import { MSG } from '$lib/brush/messages';
import { emptyPlan, serializePlan, type Plan } from '$lib/plan';
import { PLAN_KEY } from '$lib/sharing/storage';
import { longTexts } from '$lib/shell/test/rest-text';
import { page as appPage } from '../test-stubs/app/state';
import manifestJson from '../../e2e/fixtures/data/fixture-0/manifest.json';
import PaintHeaderHost from './test/PaintHeaderHost.svelte';

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));

const manifest = manifestJson as unknown as Manifest;

const data = () => ({
  plan: emptyPlan('fixture-0'),
  manifest,
  fellBack: false,
  manifestError: false,
  datasetVersion: 'fixture-0',
  appRelease: 'dev',
  user: null,
  signInAvailable: true
});

describe('/ at rest (rule: no text of 12 words or more)', () => {
  beforeEach(async () => {
    await page.viewport(1024, 768);
    // The page spawns the sim worker; a stub keeps this about the page's text.
    vi.stubGlobal(
      'Worker',
      class {
        onmessage = null;
        postMessage() {}
        terminate() {}
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    appPage.state = {};
  });

  it('/ at rest shows no text of 12 words or more outside a notice or a dialog', async () => {
    render(PaintHeaderHost, { props: { data: data() } });
    await expect.element(page.getByRole('radiogroup', { name: 'Tool' })).toBeVisible();
    await expect.element(page.getByText(MSG.start, { exact: true })).toBeVisible();
    await expect.element(page.getByTestId('score-bar')).toBeVisible();
    expect(longTexts()).toEqual([]);
  });

  it('nor with a restored stroke', async () => {
    const plan: Plan = {
      schema: 1,
      datasetVersion: 'fixture-0',
      ops: [{ id: 's1', kind: 'paint', stories: 6, radiusM: 20, path: [[-122.4193, 37.76013]] }]
    };
    localStorage.setItem(
      PLAN_KEY,
      JSON.stringify({ v: 1, savedAt: '2026-10-11T00:00:00.000Z', plan: serializePlan(plan) })
    );
    render(PaintHeaderHost, { props: { data: data() } });
    await expect.element(page.getByRole('radiogroup', { name: 'Tool' })).toBeVisible();
    await expect.element(page.getByTestId('score-bar')).toBeVisible();
    expect(page.getByText(MSG.start, { exact: true }).elements()).toEqual([]);
    expect(longTexts()).toEqual([]);
  });
});
