// The data `/` gets in a test: the load's HomeData and the root layout's fields, every one typed.
import type { ComponentProps } from 'svelte';
import type { Manifest } from '$lib/data/manifest';
import { emptyPlan } from '$lib/plan';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import type Page from '../+page.svelte';

const MANIFEST = manifestJson as unknown as Manifest;

/** `/`'s data on fixture-0: an empty plan, the fixture manifest, no calibration, no user. */
export function homeData(
  over: { manifest?: Manifest | null; manifestError?: boolean } = {}
): ComponentProps<typeof Page>['data'] {
  return {
    plan: emptyPlan('fixture-0'),
    manifest: over.manifest === undefined ? MANIFEST : over.manifest,
    manifestError: over.manifestError ?? false,
    calibration: null,
    calibrationError: false,
    noScenario: false,
    datasetVersion: 'fixture-0',
    appRelease: 'dev',
    user: null,
    signInAvailable: true
  };
}
