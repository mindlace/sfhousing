// The live freeway-land catalog and basemap id list (pipeline/enrichment/lesscars) held to the
// owner-approved section of docs/lesscars/plan-v1.md ("v1.1 (2026-11-03): freeway removal and
// freeway land"). This file parses the section's tables itself, so it checks the transcription
// rather than echoing whatever produced the files. The section's kept-segment tables show only
// the largest rows; freeway-land.draft.json is the full list for those (`rule`) segments.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBasemapIds } from '../lib/lesscars/basemap-ids';
import { parseFreewayLand, type FreewaySegment } from '../lib/lesscars/freeway-land';
import { LESSCARS_BASEMAP_IDS_JSON, LESSCARS_FREEWAY_LAND_JSON } from '../lesscars-config';
import { table, under, unTick } from './lesscars-doc';

const ROOT = join(import.meta.dirname, '../..');
const DOC = readFileSync(join(ROOT, 'docs/lesscars/plan-v1.md'), 'utf8');
const SECTION = DOC.slice(
  DOC.indexOf('## v1.1 (2026-11-03): freeway removal and freeway land'),
  DOC.indexOf('## Appendix A: plan.json fields')
);
const catalog = parseFreewayLand(JSON.parse(readFileSync(LESSCARS_FREEWAY_LAND_JSON.live, 'utf8')));
const draft = parseFreewayLand(
  JSON.parse(
    readFileSync(join(ROOT, 'pipeline/enrichment/lesscars/freeway-land.draft.json'), 'utf8')
  )
);
const ids = parseBasemapIds(JSON.parse(readFileSync(LESSCARS_BASEMAP_IDS_JSON.live, 'utf8')));

const segmentRows = () => table(under(SECTION, '### Freeway segments'));
const sectionSegments = () => segmentRows().map((r) => unTick(r['Segment id']));
const landRows = (id: string) => table(under(under(SECTION, '### Freeway land'), `#### ${id}`));
const rows = (id: string) =>
  landRows(id).map((r) => ({
    parcel: unTick(r['Parcel']),
    decision: r['Decision'],
    reason: r['Reason']
  }));
const sectionCnns = (id: string) =>
  segmentRows()
    .find((r) => unTick(r['Segment id']) === id)!
    ['CNNs'].replace(/^\d+:\s*/, '')
    .split(/\s+/);
const byId = (id: string): FreewaySegment => catalog.segments.find((s) => s.id === id)!;
const draftSegment = (id: string) => draft.segments.find((s) => s.id === id)!;

const listed = new Set(catalog.segments.flatMap((s) => s.parcels));
const excludedWithReason = (id: string) =>
  catalog.segments.some((s) => s.excluded.some((e) => e.parcel === id && e.reason !== '')) ||
  SECTION.includes(`| \`${id}\``);
const decided = (id: string) => listed.has(id) || excludedWithReason(id);

/** The owner's example parcels: the ids of the section's "owner's example" bullet. */
const EXAMPLE_14 = [
  ...new Set(
    (
      SECTION.match(/- \*\*The owner's example\*\*[\s\S]*?\n- \*\*/)![0].match(/`\d{7}`/g) ?? []
    ).map(unTick)
  )
];

describe('v1.1 enrichment files equal the approved section', () => {
  it('freeway-land.json equals the section, segment for segment', () => {
    expect(catalog.segments.map((s) => s.id)).toEqual(sectionSegments());
    for (const seg of catalog.segments.filter((s) => s.curated === 'hand')) {
      const r = rows(seg.id);
      expect(seg.parcels, seg.id).toEqual(
        r
          .filter((x) => x.decision === 'in')
          .map((x) => x.parcel)
          .sort()
      );
      // a parcel moved to a kept segment is `out` in the table only (one segment per parcel)
      for (const e of seg.excluded)
        expect(
          r.find((x) => x.parcel === e.parcel),
          `${seg.id} ${e.parcel}`
        ).toMatchObject({
          decision: 'out',
          reason: e.reason
        });
      for (const x of r.filter((y) => y.decision === 'out' && y.reason !== ''))
        expect(
          seg.excluded.some((e) => e.parcel === x.parcel) || listed.has(x.parcel),
          `${seg.id} ${x.parcel}`
        ).toBe(true);
    }
    for (const seg of catalog.segments.filter((s) => s.curated === 'rule'))
      for (const x of rows(seg.id)) {
        if (x.decision === 'in' || x.decision === 'rule')
          expect(seg.parcels, `${seg.id} ${x.parcel}`).toContain(x.parcel);
        else expect(seg.parcels, `${seg.id} ${x.parcel}`).not.toContain(x.parcel);
      }
  });
  it('every excluded parcel has a reason and no parcel is `in` twice', () => {
    const all = catalog.segments.flatMap((s) => s.parcels);
    expect(new Set(all).size).toBe(all.length);
    for (const s of catalog.segments)
      for (const e of s.excluded) expect(e.reason.length, `${s.id} ${e.parcel}`).toBeGreaterThan(0);
  });
  it('each segment has the CNNs of its Freeway segments row', () => {
    for (const seg of catalog.segments) expect(seg.cnn, seg.id).toEqual(sectionCnns(seg.id));
    expect(byId('i80-soma').cnn).toEqual(expect.arrayContaining(['19374000', '19383000']));
    expect(byId('i80-bay-bridge').cnn).not.toContain('19374000');
    const all = catalog.segments.flatMap((s) => s.cnn);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(218);
  });
  it('a rule segment equals freeway-land.draft.json, and the spot-check removals are excluded', () => {
    for (const seg of catalog.segments.filter((s) => s.curated === 'rule'))
      expect(seg.parcels, seg.id).toEqual(draftSegment(seg.id).parcels);
    for (const id of ['4382003', '4349004', '5232011']) expect(listed.has(id), id).toBe(false);
  });
  it('every segment a phase removes is curated by hand', () => {
    for (const s of catalog.segments.filter((x) => x.removedBy))
      expect(s.curated, s.id).toBe('hand');
  });
  it('the stub parcels and the owner’s example are freeway land', () => {
    for (const id of ['3502112', '3503002', '3513071', '3513074'])
      expect(listed.has(id), id).toBe(true);
    expect(EXAMPLE_14).toHaveLength(14);
    expect(EXAMPLE_14.every((id) => listed.has(id) || excludedWithReason(id))).toBe(true);
  });
  it('the parcels recon flagged are decided with a reason', () => {
    for (const id of ['3179011', '3179010', '4012031', '4154001'])
      expect(decided(id), id).toBe(true);
  });
  it('basemap-ids.json equals the section, phase for phase, and names only removal phases', () => {
    const keep = table(under(SECTION, '### Basemap ids')).map((r) => ({
      project: unTick(r['Phase']),
      ids: (r['Keep'].match(/\b\d{14}\b/g) ?? [])
        .filter((_, i, a) => a.indexOf(_) === i)
        .map(Number)
        .sort((a, b) => a - b)
    }));
    expect(ids.phases.map((p) => ({ project: p.project, ids: p.ids }))).toEqual(keep);
    for (const p of ids.phases)
      expect(
        catalog.segments.some((s) => s.removedBy === p.project),
        p.project
      ).toBe(true);
  });
});
