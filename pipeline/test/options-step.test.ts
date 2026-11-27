import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Worker } from 'node:worker_threads';
import { deflateRawSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseManifest, type Manifest } from '../../src/lib/data/manifest';
import {
  encodeOptionPayload,
  optionTableOf,
  type OptionTable
} from '../../src/lib/data/option-table';
import type { ParcelId, ParcelRecord } from '../../src/lib/data/parcel';
import type { ScenarioParcels } from '../../src/lib/data/scenario-codec';
import { allowedCount } from '../../src/lib/sim/choice/choose';
import { heightTime, opt, shippedPrices } from '../../src/lib/sim/choice/test/model';
import { OPTIONS_BIN, PARCELS_BIN } from '../lib/scenario-files';
import { checkOptions, optionsOf } from '../steps/check-options';
import {
  PANEL_OPTIONS_BIN,
  PANEL_OPTIONS_KEYS,
  candidateRow,
  candidateRows,
  loadChunkRecords,
  readOptionsBin,
  writeOptions,
  type CandidateJob,
  type CandidateRows
} from '../steps/options';
import { readParcelsBin } from '../steps/scenario';

const E2E = 'e2e/fixtures/data/fixture-0';

/** fixture-0's parcels.bin rows as candidate jobs. */
const jobsOf = (p: ScenarioParcels): CandidateJob[] =>
  p.id.map((id, i) => ({
    id,
    existingUnits: p.existingUnits[i],
    existingFloorAreaM2: p.existingFloorAreaM2[i],
    existingStories: p.existingStories[i],
    eligible: p.eligible[i] === 1
  }));

/** A temp copy of fixture-0 with `t` as its options.bin. */
function withTable(t: OptionTable): string {
  const dir = mkdtempSync(join(tmpdir(), 'sfh-options-'));
  cpSync(join(E2E, 'manifest.json'), join(dir, 'manifest.json'));
  mkdirSync(join(dir, 'scenarios/fzp'), { recursive: true });
  cpSync(join(E2E, PARCELS_BIN), join(dir, PARCELS_BIN));
  writeFileSync(join(dir, OPTIONS_BIN), deflateRawSync(encodeOptionPayload(t), { level: 9 }));
  return dir;
}

/** `t` with row `i` replaced. */
function replaceRow(
  t: OptionTable,
  i: number,
  row: { options: ReturnType<typeof optionsOf>; locationValue: number }
) {
  const rows = Array.from({ length: t.count }, (_, k) =>
    k === i ? row : { options: optionsOf(t, k), locationValue: t.locationValue[k] }
  );
  return optionTableOf(t.datasetVersion, rows);
}

describe('options step on the mini fixture', () => {
  let m: Manifest;
  let p: ScenarioParcels;
  let t: OptionTable;
  let records: Map<ParcelId, ParcelRecord>;

  beforeAll(() => {
    m = parseManifest(JSON.parse(readFileSync(join(E2E, 'manifest.json'), 'utf8')));
    p = readParcelsBin(join(E2E, PARCELS_BIN));
    t = readOptionsBin(join(E2E, OPTIONS_BIN));
    records = loadChunkRecords(E2E);
  });

  it('options.bin decodes with one row per parcels.bin row and its datasetVersion', () => {
    expect(t.count).toBe(p.count);
    expect(t.datasetVersion).toBe(p.datasetVersion);
    expect(m.scenarios?.fzp.options).toBe(`/data/${m.datasetVersion}/${OPTIONS_BIN}`);
    expect(t.offset[t.count]).toBeGreaterThan(0);
  });

  it('passes V36, V40 and V41', () => {
    const r = checkOptions(E2E, m, p, records, true);
    expect(r.map((x) => x.id)).toEqual(['V36', 'V40', 'V41']);
    for (const x of r) expect(x, x.detail).toMatchObject({ ok: true });
  });

  it("keeps the largest lot's 12-story option when the cap is 13", () => {
    let lot = 0;
    for (let i = 1; i < p.count; i++) if (p.lotAreaM2[i] > p.lotAreaM2[lot]) lot = i;
    const n = allowedCount(t, lot, 13);
    const stories = optionsOf(t, lot)
      .slice(0, n)
      .map((o) => o.stories);
    expect(stories).toContain(12);
  });

  it('builds the same candidates in this thread and on 2 workers (batch 4)', async () => {
    const jobs = jobsOf(p);
    const a = await candidateRows(E2E, jobs, 0);
    const b = await candidateRows(E2E, jobs, 2, { batch: 4 });
    expect(b).toEqual(a);
    expect(a.count).toBe(p.count);
  }, 300_000);

  it('a failing worker rejects and leaves no worker running', async () => {
    const exited: boolean[] = [];
    const onWorker = (w: Worker) => {
      const k = exited.push(false) - 1;
      w.once('exit', () => (exited[k] = true));
    };
    await expect(
      candidateRows(E2E, jobsOf(p), 3, { batch: 4, onWorker, failWorker: 0 })
    ).rejects.toThrow('options worker 0: test failure');
    expect(exited).toEqual([true, true, true]);
  });

  it('V36 fails on a row holding a dominated option', () => {
    const row = {
      options: [opt('V', 'walkup', 3, 10), opt('V', 'walkup', 4, 9)],
      locationValue: 1
    };
    const r = checkOptions(withTable(replaceRow(t, 0, row)), m, p, records, true);
    expect(r[0].ok).toBe(false);
    expect(r[0].detail).toContain(`row 0 (${p.id[0]}) holds an option`);
  });

  it('V40 fails on Type V above 6 stories and Type III above 8', () => {
    const row = {
      options: [opt('V', 'walkup', 7, 30), opt('III', 'podium', 9, 80)],
      locationValue: 1
    };
    const r = checkOptions(withTable(replaceRow(t, 0, row)), m, p, records, true);
    expect(r[1].ok).toBe(false);
    expect(r[1].detail).toContain('Type V at 7 stories');
    expect(r[1].detail).toContain('Type III at 9 stories');
  });

  it('V41 fails on a location value that is not finite and above 0', () => {
    const bad = replaceRow(replaceRow(t, 0, { options: [], locationValue: NaN }), 1, {
      options: optionsOf(t, 1),
      locationValue: 0
    });
    const r = checkOptions(withTable(bad), m, p, records, true);
    expect(r[2].ok).toBe(false);
    expect(r[2].detail).toContain('row 0');
    expect(r[2].detail).toContain('row 1');
  });
});

describe('writeOptions', () => {
  const pack = (rows: ReturnType<typeof opt>[][]): CandidateRows => {
    const offset = new Uint32Array(rows.length + 1);
    const flat: number[] = [];
    const types = ['V', 'III', 'I'];
    const forms = ['plex', 'walkup', 'podium', 'midrise', 'block', 'tower'];
    rows.forEach((r, i) => {
      offset[i] = flat.length / 5;
      for (const o of r)
        flat.push(types.indexOf(o.type), forms.indexOf(o.form), o.stories, o.plates, o.homes);
    });
    offset[rows.length] = flat.length / 5;
    return {
      count: rows.length,
      offset,
      packed: Uint32Array.from(flat),
      district: Uint8Array.of(0, 1)
    };
  };

  it('prunes, clamps, adds location values, writes the panel rows and reports', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'sfh-options-out-'));
    const derivedDir = mkdtempSync(join(tmpdir(), 'sfh-options-derived-'));
    const lots = pack([
      [opt('V', 'walkup', 3, 10), opt('V', 'walkup', 4, 9), opt('I', 'midrise', 5, 70_000)],
      []
    ]);
    const panel = pack([[opt('V', 'plex', 2, 4)]]);
    const key: CandidateJob = {
      id: 'B',
      existingUnits: 1,
      existingFloorAreaM2: 100,
      existingStories: 1,
      eligible: true,
      prune: true
    };
    const { counts, warnings } = writeOptions({
      outDir,
      derivedDir,
      datasetVersion: 'fixture-9',
      candidates: { lotIds: ['A', 'B'], lots, panel, panelKeys: [key] },
      step: {
        prices: shippedPrices(),
        heightTime,
        aboveTop: { ratio: 1.21, n: [0, 0], provenance: heightTime.provenance },
        filedToIssued: [],
        provenance: { anchors: heightTime.provenance, carrying: heightTime.provenance }
      },
      locationValue: new Map([
        ['A', 1.2],
        ['B', 0.8]
      ])
    });
    const t = readOptionsBin(join(outDir, OPTIONS_BIN));
    expect(optionsOf(t, 0)).toEqual([opt('V', 'walkup', 3, 10), opt('I', 'midrise', 5, 0xffff)]);
    expect(optionsOf(t, 1)).toEqual([]);
    expect(Array.from(t.locationValue)).toEqual([Math.fround(1.2), Math.fround(0.8)]);
    expect(counts).toMatchObject({
      'options.rows': 2,
      'options.lots': 1,
      'options.values': 2,
      'options.per_lot.max': 2,
      'options.clamped': 1,
      'options.district_rows': 1,
      'options.panel.rows': 1,
      'options.panel.values': 1
    });
    expect(warnings).toEqual([expect.stringContaining('1 lot(s) have options above 65535 homes')]);
    const pt = readOptionsBin(join(derivedDir, PANEL_OPTIONS_BIN));
    expect(optionsOf(pt, 0)).toEqual([opt('V', 'plex', 2, 4)]);
    expect(pt.locationValue[0]).toBe(Math.fround(0.8));
    expect(JSON.parse(readFileSync(join(derivedDir, PANEL_OPTIONS_KEYS), 'utf8'))).toEqual([
      {
        mapblklot: 'B',
        existingUnits: 1,
        existingFloorAreaM2: 100,
        existingStories: 1,
        eligible: true
      }
    ]);
    expect(candidateRow(lots, 0)).toHaveLength(3);
  });

  it('throws on a lot without a location value', () => {
    const lots = pack([[], []]);
    expect(() =>
      writeOptions({
        outDir: mkdtempSync(join(tmpdir(), 'sfh-options-out-')),
        derivedDir: mkdtempSync(join(tmpdir(), 'sfh-options-derived-')),
        datasetVersion: 'fixture-9',
        candidates: { lotIds: ['A', 'B'], lots, panel: pack([]), panelKeys: [] },
        step: {
          prices: shippedPrices(),
          heightTime,
          aboveTop: { ratio: 1.21, n: [0, 0], provenance: heightTime.provenance },
          filedToIssued: [],
          provenance: { anchors: heightTime.provenance, carrying: heightTime.provenance }
        },
        locationValue: new Map([['A', 1]])
      })
    ).toThrow('options: lot B has no location value');
  });
});
