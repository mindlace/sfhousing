/// <reference types="@vitest/browser-playwright" />
// Rule 37: /sim at rest, and with Results open, shows no sentence of 12 words or more outside a
// notice, a dialog or an open explanation. SimPageHost over the fake timeline worker.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tick, type ComponentProps } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { parseManifest } from '$lib/data/manifest';
import { longTexts } from '$lib/shell/test/rest-text';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import type { TimelineHostResponse } from '$lib/sim/timeline-protocol';
import type { ScoreStatics } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';
import {
  FakeTimelineWorker,
  compiledMsg,
  filledMsg
} from '$lib/timeline/test/fake-timeline-worker';
import { statics as baseStatics } from '$lib/timeline/test/fixtures';
import { LIMITS_CAPTION } from '$lib/view/LayerSwitches.svelte';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import '$lib/sim-page/debug';
import type SimPage from '$lib/sim-page/SimPage.svelte';
import SimPageHost from '$lib/sim-page/test/SimPageHost.svelte';

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));
const workers = vi.hoisted(() => [] as FakeTimelineWorker[]);
vi.mock('$lib/sim/client', async (orig) => {
  const { FakeTimelineWorker } = await import('$lib/timeline/test/fake-timeline-worker');
  return {
    ...(await orig<typeof import('$lib/sim/client')>()),
    spawnSimWorker: () => {
      const w = new FakeTimelineWorker();
      workers.push(w);
      return w;
    }
  };
});

const manifest = parseManifest(manifestJson);
const cal = fixtureCalibration();
const asOf = cal.asOf;
const LAST = 23;
const { y, m } = utcParts(asOf);
const MONTHS: Day[] = Array.from({ length: LAST + 1 }, (_, i) => dayFromUtc(y, m + i, 1));
const STATICS: ScoreStatics = { ...baseStatics({ lastIndex: LAST }), asOf, months: MONTHS };

const w = () => workers[workers.length - 1];
const emit = (r: TimelineHostResponse) => w().emit(r);

async function opened() {
  const props: ComponentProps<typeof SimPage> = {
    manifest,
    manifestError: false,
    calibration: cal,
    calibrationError: false,
    noScenario: false,
    datasetVersion: 'fixture-0',
    reload: async () => ({ manifest, calibration: cal })
  } as ComponentProps<typeof SimPage>;
  const r = render(SimPageHost, { props });
  await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
  emit(compiledMsg(1, STATICS));
  emit(filledMsg(1, 0, LAST + 1));
  return r;
}

describe('rest text (rules 37 to 39)', () => {
  beforeEach(() => {
    workers.length = 0;
  });

  it('shows no text of 12 words or more at rest outside a notice, a dialog or an open explanation', async () => {
    await opened();
    await expect.element(page.getByTestId('score-bar')).toBeVisible();
    expect(longTexts()).toEqual([]);
  });

  it('shows none with Results open either', async () => {
    await opened();
    await page.getByTestId('score-bar').click();
    await expect.element(page.getByTestId('tl-results')).toBeVisible();
    await tick();
    expect(longTexts()).toEqual([]);
  });

  it('/sim at rest with the key open shows no text of 12 words or more', async () => {
    await page.viewport(1280, 800);
    await opened();
    await expect.element(page.getByTestId('score-bar')).toBeVisible();
    const key = page.getByRole('group', { name: 'Map key' });
    await expect.element(key).toBeVisible();
    await expect.element(key.getByText('Planning review')).toBeVisible();
    await expect.element(key.getByText('Just changed stage')).toBeVisible();
    await expect.element(key.getByText('Bar: progress and chance of finishing')).toBeVisible();
    expect(longTexts()).toEqual([]);
  });

  it('/sim with the Layers panel open: only the height limits caption runs long', async () => {
    await page.viewport(1280, 800);
    await opened();
    await page.getByRole('button', { name: 'Map layers' }).click();
    const layers = page.getByRole('group', { name: 'Map layers' });
    await expect.element(layers).toBeVisible();
    await expect.element(layers.getByText('BART / Caltrain')).toBeVisible();
    await expect.element(layers.getByText(/^Estimated weekday/)).toBeVisible();
    // The plan keeps the Layers rows' words unchanged (The strings), and the limits caption, moved
    // from the View menu, is the one text of 12 words or more. It shows only on a press, never at
    // rest; shortening it is a copy change for the owner (Task 6 report).
    expect(longTexts()).toEqual([LIMITS_CAPTION]);
  });
});
