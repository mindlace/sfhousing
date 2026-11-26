// The low-zoom gate (spec "3. Parts at z12-13" and "Acceptance"): what drawing parts at z12-13 may
// cost. Compares two built buildings.pmtiles archives: z12 stored bytes may grow by at most 60,000
// and the parcels still drawn at z12 may fall by at most 1%.
//   npx tsx scripts/low-zoom-gate.ts --before <pmtiles> --after <pmtiles> [--inspect <lng,lat>]
// --inspect prints the after archive's z13 features of the tile holding the point (parcelId,
// heightM, baseM, one per line), then their count.
import { pathToFileURL } from 'node:url';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { PMTiles } from 'pmtiles';
import { BBOX } from '../pipeline/config';
import { NodeFileSource } from '../pipeline/lib/pmtiles-file';
import { parcelIdsAtZoom, z12TileBytes } from '../pipeline/steps/tiles';

export interface LowZoomStats {
  z12Bytes: number;
  z12Parcels: number;
  z13Parcels: number;
}

const MAX_BYTES = 60_000;
const MAX_PARCEL_DROP = 0.01;

/**
 * ok iff after.z12Bytes - before.z12Bytes <= 60_000 and
 * before.z12Parcels - after.z12Parcels <= 0.01 * before.z12Parcels; lines: one per measure.
 */
export function lowZoomGate(
  before: LowZoomStats,
  after: LowZoomStats
): { ok: boolean; lines: string[] } {
  const grew = after.z12Bytes - before.z12Bytes;
  const dropped = before.z12Parcels - after.z12Parcels;
  const bytesOk = grew <= MAX_BYTES;
  const parcelsOk = dropped <= MAX_PARCEL_DROP * before.z12Parcels;
  const sign = (n: number): string => `${n >= 0 ? '+' : ''}${n}`;
  const lines = [
    `${bytesOk ? 'ok  ' : 'FAIL'} z12 bytes ${before.z12Bytes} -> ${after.z12Bytes} (${sign(grew)} B, limit +${MAX_BYTES})`,
    `${parcelsOk ? 'ok  ' : 'FAIL'} z12 parcels ${before.z12Parcels} -> ${after.z12Parcels} (${sign(-dropped)}, limit -${MAX_PARCEL_DROP * 100}%)`,
    `info z13 parcels ${before.z13Parcels} -> ${after.z13Parcels}`
  ];
  return { ok: bytesOk && parcelsOk, lines };
}

async function statsOf(file: string): Promise<LowZoomStats> {
  return {
    z12Bytes: await z12TileBytes(file, BBOX),
    z12Parcels: await parcelIdsAtZoom(file, 12, BBOX),
    z13Parcels: await parcelIdsAtZoom(file, 13, BBOX)
  };
}

/** The z13 features of the tile holding the point, as `parcelId heightM baseM` lines. */
export async function inspectZ13(file: string, lng: number, lat: number): Promise<string[]> {
  const z = 13;
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  const t = await new PMTiles(new NodeFileSource(file)).getZxy(z, x, y);
  const layer = t ? new VectorTile(new Pbf(new Uint8Array(t.data))).layers.buildings : undefined;
  const lines: string[] = [];
  for (let i = 0; i < (layer?.length ?? 0); i++) {
    const p = layer.feature(i).properties;
    lines.push(`${p.parcelId} ${p.heightM} ${p.baseM}`);
  }
  return [...lines, `${lines.length} features in tile ${z}/${x}/${y}`];
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const before = flag(args, '--before');
  const after = flag(args, '--after');
  if (!before || !after) {
    console.error(
      'usage: low-zoom-gate.ts --before <pmtiles> --after <pmtiles> [--inspect <lng,lat>]'
    );
    return 2;
  }
  const result = lowZoomGate(await statsOf(before), await statsOf(after));
  console.log(result.lines.join('\n'));
  const at = flag(args, '--inspect');
  if (at) {
    const [lng, lat] = at.split(',').map(Number);
    console.log((await inspectZ13(after, lng, lat)).join('\n'));
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    }
  );
