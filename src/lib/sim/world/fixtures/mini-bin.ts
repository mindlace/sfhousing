// Node-only: the mini city's `parcels.bin` bytes (deflate-raw over the T11 payload), as served.
// Kept apart from mini-parcels.ts so that module stays browser-safe.
import { deflateRawSync } from 'node:zlib';
import { encodeScenarioPayload } from '$lib/data/scenario-codec';
import { miniCity } from './mini-parcels';

export function miniBin(): Uint8Array {
  return new Uint8Array(deflateRawSync(encodeScenarioPayload(miniCity().parcels)));
}
