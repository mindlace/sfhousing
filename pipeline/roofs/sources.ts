import { run } from '../lib/exec';
import { ROOF_PYTHON } from './setup';
import type { Http } from '../lib/http';
import type { LockEntry, LockSpatial } from '../lib/lock';
import { storeBytes } from '../lib/raw';

export interface RoofSourceConfig {
  schemaVersion: 1;
  lidar: {
    url: string;
    horizontalCrs: string;
    verticalCrs: string | null;
    horizontalUnits: string;
    verticalUnits: string;
    acquisitionStart: string | null;
    acquisitionEnd: string | null;
    license: string;
  };
  coverage: { id: string; bbox: [number, number, number, number] }[];
  supportBufferM: number;
  aerial: {
    url: string;
    zoom: number;
    enabled: boolean;
    license?: string;
    permission: LockSpatial['permission'];
    alignment: LockSpatial['alignment'];
    tiles: { x: number; y: number; sha256?: string }[];
  };
}
const mercator = (lng: number, lat: number): [number, number] => [
  ((lng * Math.PI) / 180) * 6378137,
  Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 6378137
];

/** Retain original EPT objects; cropping happens offline, preserving point identity. */
export async function fetchRoofSources(opts: {
  rawDir: string;
  config: RoofSourceConfig;
  http: Http;
}): Promise<LockEntry[]> {
  const { rawDir, config, http } = opts;
  if (
    config.schemaVersion !== 1 ||
    config.lidar.horizontalCrs !== 'EPSG:3857' ||
    config.supportBufferM < 50 ||
    !Number.isFinite(config.supportBufferM)
  ) {
    throw new Error('unsupported roof source config/CRS or insufficient support buffer');
  }
  const boxes = config.coverage.map(({ bbox: [w, s, e, n] }) => {
    if (
      ![w, s, e, n].every(Number.isFinite) ||
      w >= e ||
      s >= n ||
      Math.abs(s) >= 85 ||
      Math.abs(n) >= 85
    ) {
      throw new Error('invalid roof coverage bbox');
    }
    const [x, y] = mercator(w, s),
      [xx, yy] = mercator(e, n);
    const buffer =
      config.supportBufferM /
      Math.min(Math.cos((s * Math.PI) / 180), Math.cos((n * Math.PI) / 180));
    return [x - buffer, y - buffer, xx + buffer, yy + buffer];
  });
  const files: LockEntry['files'] = [];
  async function get(relative: string, base = config.lidar.url, expectedSha?: string) {
    const url = base === config.lidar.url ? new URL(relative, base).href : base;
    const response = await http.get(url);
    if (response.status !== 200) throw new Error(`GET ${url}: HTTP ${response.status}`);
    const file = storeBytes(rawDir, relative, url, response.body);
    if (expectedSha && file.sha256 !== expectedSha) throw new Error(`sha256 mismatch: ${url}`);
    files.push(file);
    return response.body;
  }
  const meta = JSON.parse(new TextDecoder().decode(await get('ept.json'))) as {
    bounds: number[];
    dataType: string;
    srs?: { horizontal?: string; vertical?: string; wkt?: string };
  };
  if (
    meta.dataType !== 'laszip' ||
    meta.bounds.length !== 6 ||
    !meta.bounds.every(Number.isFinite) ||
    meta.srs?.horizontal !== '3857'
  )
    throw new Error('unsupported EPT metadata');
  const intersects = (key: string) => {
    if (!/^\d+-\d+-\d+-\d+$/.test(key)) throw new Error(`invalid EPT node ${key}`);
    const [d, x, y, z] = key.split('-').map(Number);
    if (d > 30 || [x, y, z].some((v) => v >= 2 ** d)) throw new Error(`invalid EPT node ${key}`);
    const size = (meta.bounds[3] - meta.bounds[0]) / 2 ** d;
    const nx = meta.bounds[0] + x * size,
      ny = meta.bounds[1] + y * size;
    return boxes.some((b) => nx <= b[2] && nx + size >= b[0] && ny <= b[3] && ny + size >= b[1]);
  };
  const pages = ['0-0-0-0'],
    seen = new Set<string>(),
    nodes = new Map<string, number>();
  while (pages.length) {
    const page = pages.shift()!;
    if (seen.has(page)) continue;
    seen.add(page);
    const hierarchy = JSON.parse(
      new TextDecoder().decode(await get(`ept-hierarchy/${page}.json`))
    ) as Record<string, number>;
    for (const [key, count] of Object.entries(hierarchy).sort(([a], [b]) => a.localeCompare(b))) {
      if (!Number.isSafeInteger(count) || count < -1)
        throw new Error('invalid EPT hierarchy count');
      if (!intersects(key)) continue;
      if (count === -1) {
        if (!seen.has(key)) pages.push(key);
      } else if (count > 0) {
        if (nodes.has(key) && nodes.get(key) !== count)
          throw new Error(`conflicting EPT node ${key}`);
        nodes.set(key, count);
      }
    }
  }
  for (const key of [...nodes.keys()].sort()) await get(`ept-data/${key}.laz`);
  const spatial: LockSpatial = {
    horizontalCrs: config.lidar.horizontalCrs,
    verticalCrs: meta.srs?.vertical ? `EPSG:${meta.srs.vertical}` : config.lidar.verticalCrs,
    horizontalUnits: config.lidar.horizontalUnits,
    verticalUnits: config.lidar.verticalUnits,
    acquisitionStart: config.lidar.acquisitionStart,
    acquisitionEnd: config.lidar.acquisitionEnd,
    coverage: config.coverage,
    supportBufferM: config.supportBufferM,
    permission: 'confirmed',
    alignment: 'not-applicable',
    objects: files.map((f) => ({ name: f.name, url: f.url, sha256: f.sha256 }))
  };
  const common = { retrievedAt: new Date().toISOString(), upstreamVersion: '2023', rowCount: 0 };
  const lidar: LockEntry = {
    ...common,
    id: 'roof-lidar',
    files: [...files],
    rowCount: [...nodes.values()].reduce((a, b) => a + b, 0),
    license: config.lidar.license,
    homepage: config.lidar.url,
    label: 'USGS CA_SanFrancisco_1_B23 (spring 2023; exact dates unknown)',
    spatial
  };
  files.length = 0;
  const transforms: LockSpatial['tiles'] = [];
  const aerialCoverage: LockSpatial['coverage'] = [];
  if (config.aerial.enabled && config.aerial.permission === 'confirmed') {
    if (!config.aerial.license || config.aerial.license === 'unconfirmed')
      throw new Error('confirmed aerial permissions require license terms');
    if (config.aerial.zoom !== 19) throw new Error('unsupported aerial zoom');
    for (const tile of [...config.aerial.tiles].sort((a, b) => a.x - b.x || a.y - b.y)) {
      if (![tile.x, tile.y].every((v) => Number.isSafeInteger(v) && v >= 0 && v < 2 ** 19))
        throw new Error('invalid aerial tile');
      const url = config.aerial.url
        .replace('{z}', '19')
        .replace('{x}', String(tile.x))
        .replace('{y}', String(tile.y));
      const bytes = await get(`aerial/19/${tile.x}/${tile.y}.png`, url, tile.sha256);
      const inspected = await run(
        ROOF_PYTHON,
        [
          '-c',
          'import sys,io,base64,json; from PIL import Image; image=Image.open(io.BytesIO(base64.b64decode(sys.stdin.read()))); image.load(); print(json.dumps([image.format,*image.size]))'
        ],
        { input: Buffer.from(bytes).toString('base64') }
      );
      if (inspected.code !== 0) throw new Error('corrupt aerial image');
      const [format, width, height] = JSON.parse(inspected.stdout) as [string, number, number];
      if (format !== 'PNG' || width !== 512 || height !== 512)
        throw new Error('aerial image format/dimensions disagree with zoom-19 raster transform');
      const lat = (y: number) =>
        (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** 19))) * 180) / Math.PI;
      aerialCoverage.push({
        id: `19/${tile.x}/${tile.y}`,
        bbox: [
          (tile.x / 2 ** 19) * 360 - 180,
          lat(tile.y + 1),
          ((tile.x + 1) / 2 ** 19) * 360 - 180,
          lat(tile.y)
        ]
      });
      const scale = (2 * Math.PI * 6378137) / 2 ** 19 / 512;
      transforms.push({
        x: tile.x,
        y: tile.y,
        zoom: 19,
        width: 512,
        height: 512,
        transform: [
          scale,
          0,
          -Math.PI * 6378137 + tile.x * 512 * scale,
          0,
          -scale,
          Math.PI * 6378137 - tile.y * 512 * scale
        ]
      });
    }
  }
  return [
    lidar,
    {
      ...common,
      id: 'roof-aerial',
      files: [...files],
      license: config.aerial.license ?? 'unconfirmed',
      homepage: config.aerial.url,
      label: 'SF Planning p2023_rgb8cm',
      spatial: {
        ...spatial,
        horizontalCrs: 'EPSG:3857',
        verticalCrs: null,
        permission: config.aerial.permission,
        alignment: config.aerial.alignment,
        coverage: aerialCoverage,
        status:
          config.aerial.enabled && config.aerial.permission === 'confirmed'
            ? files.length
              ? 'available'
              : 'unavailable'
            : 'disabled',
        objects: files.map((f) => ({ name: f.name, url: f.url, sha256: f.sha256 })),
        tiles: transforms
      }
    }
  ];
}
