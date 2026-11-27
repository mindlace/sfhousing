// The mini city as the files a dataset serves: the bodies by URL and the manifest that names
// them, for tests that load a dataset through fake fetches. Test-only, Node-only (it uses
// node:zlib).
import { deflateRawSync } from 'node:zlib';
import type { Manifest } from '$lib/data/manifest';
import { encodeOptionPayload, type OptionTable } from '$lib/data/option-table';
import { encodePolicyPayload } from '$lib/data/policy-codec';
import { encodeScenarioPayload, type ScenarioParcels } from '$lib/data/scenario-codec';
import { encodeTransit } from '$lib/data/transit-codec';
import { miniBin } from '$lib/sim/world/fixtures/mini-bin';
import { miniNeighborhoods, miniTransit } from '$lib/sim/world/fixtures/mini-brushes';
import { MINI_OPTIONS_URL, miniOptions } from '$lib/sim/world/fixtures/mini-options';
import { MINI_SCENARIO_URLS, MINI_VERSION, miniCity } from '$lib/sim/world/fixtures/mini-parcels';
import { miniPolicy } from '$lib/sim/world/fixtures/mini-policy';
import { miniProjectsJson } from '$lib/sim/world/fixtures/mini-projects';
import miniCalibration from '$lib/sim/world/fixtures/mini-calibration.json';

/** Where `miniDataset` serves `miniPolicy` as policy.bin (in the manifest under `policy`). */
export const MINI_POLICY_URL = `/data/${MINI_VERSION}/scenarios/fzp/policy.bin`;
// Older datasets name frontage.bin; nothing may fetch it, so no body is served for it.
export const MINI_FRONTAGE_URL = `/data/${MINI_VERSION}/scenarios/fzp/frontage.bin`;
export const MINI_TRANSIT_URL = `/data/${MINI_VERSION}/transit.json`;
export const MINI_NEIGHBORHOODS_URL = `/data/${MINI_VERSION}/neighborhoods.geojson`;

/** An options.bin body (deflate-raw) for `t`. */
export function optionsBinOf(t: OptionTable): Uint8Array {
  return new Uint8Array(deflateRawSync(encodeOptionPayload(t)));
}

/** The mini parcels.bin for (optionally) modified T11 columns. */
export function binOf(edit?: (p: ScenarioParcels) => ScenarioParcels): Uint8Array {
  if (!edit) return miniBin();
  return new Uint8Array(deflateRawSync(encodeScenarioPayload(edit(miniCity().parcels))));
}

export interface MiniDataset {
  /** Served bodies by URL: `unknown` JSON for `fetch`, `Uint8Array` for `fetchBytes`. */
  bodies: Map<string, unknown>;
  /** A fresh copy of the mini manifest (policy.bin under `policy`, options.bin under `options`). */
  manifest(): Manifest;
}

export function miniDataset(): MiniDataset {
  const city = miniCity();
  const bodies = new Map<string, unknown>();
  for (const [url, body] of Object.entries(city.chunks)) bodies.set(url, body);
  bodies.set(MINI_SCENARIO_URLS.parcels, miniBin());
  bodies.set(MINI_SCENARIO_URLS.projects, miniProjectsJson());
  bodies.set(MINI_SCENARIO_URLS.calibration, miniCalibration);
  bodies.set(
    MINI_POLICY_URL,
    new Uint8Array(deflateRawSync(encodePolicyPayload(miniPolicy(city))))
  );
  bodies.set(MINI_OPTIONS_URL, optionsBinOf(miniOptions(city)));
  bodies.set(MINI_TRANSIT_URL, JSON.parse(encodeTransit(miniTransit(city))) as unknown);
  bodies.set(MINI_NEIGHBORHOODS_URL, miniNeighborhoods(city));

  const manifest = (): Manifest => {
    const base = miniCity().manifest;
    const fzp = {
      ...base.scenarios!.fzp,
      frontage: MINI_FRONTAGE_URL,
      policy: MINI_POLICY_URL,
      options: MINI_OPTIONS_URL
    };
    return { ...base, transit: MINI_TRANSIT_URL, scenarios: { ...base.scenarios, fzp } };
  };

  return { bodies, manifest };
}
