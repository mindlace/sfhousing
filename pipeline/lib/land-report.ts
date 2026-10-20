// The land mask's reporting (docs/dev/pipeline.md "Land mask"): the clip-yield-loss check the
// scenario step runs, and the `## Land clip` section of quality-report.md.
import type { ParcelId } from '../../src/lib/data/parcel';
import type { Duck } from './duck';
import { mdTable } from './quality';

/** A clipped lot with its top-fill yield on the clipped and the original outline. */
export interface ClipYieldRow {
  id: ParcelId;
  keptShare: number;
  clippedTop: number;
  originalTop: number;
}

/**
 * The row for one clipped lot. A lot with no envelope has no top-fill yield on either outline
 * (the clipped side is 0 by the same rule), so `originalTopAt`, which would fill one story, is
 * not asked.
 */
export function clipYieldRow(r: {
  id: ParcelId;
  keptShare: number;
  clippedTop: number;
  envelopeStories: number;
  originalTopAt: () => number;
}): ClipYieldRow {
  return {
    id: r.id,
    keptShare: r.keptShare,
    clippedTop: r.clippedTop,
    originalTop: r.envelopeStories === 0 ? 0 : r.originalTopAt()
  };
}

/** Share of its area above which a clipped lot should keep its yield. */
const KEPT_SHARE = 0.95;

/**
 * Lots the clip barely shrank (keeping more than 95% of their area) that had yield on the
 * original outline and have none now. `sample` is in id order.
 */
export function clipYieldLoss(rows: ClipYieldRow[]): {
  fired: number;
  of: number;
  sample: ParcelId[];
} {
  const of = rows.filter((r) => r.keptShare > KEPT_SHARE);
  const fired = of.filter((r) => r.originalTop > 0 && r.clippedTop === 0);
  return {
    fired: fired.length,
    of: of.length,
    sample: fired.map((r) => r.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  };
}

const LARGEST = 20;

interface RemovalRow {
  id: string;
  neighborhood: string;
  land_use: string | null;
  status: string;
  orig_m2: number;
  dry_m2: number;
  removed_m2: number;
}

const m2 = (v: number) => v.toFixed(1);

/**
 * The `## Land clip` section: counts from `report_counts` (45_land.sql) and the 20 largest
 * removals from `parcel_land`, ordered by removed area descending, then id. Underwater lots
 * count by their full area.
 */
export async function landClipSection(db: Duck): Promise<string> {
  const counts = new Map(
    (await db.all<{ key: string; value: number }>(`SELECT key, value FROM report_counts`)).map(
      (r) => [r.key, r.value]
    )
  );
  const n = (k: string) => counts.get(k) ?? 0;
  const rows = await db.all<RemovalRow>(
    `SELECT l.id, p.neighborhood, o.land_use, l.status, l.orig_m2, l.dry_m2, l.removed_m2
     FROM parcel_land l JOIN parcels p USING (id) LEFT JOIN parcel_out o USING (id)
     WHERE l.status IN ('clipped', 'underwater')
     ORDER BY l.removed_m2 DESC, l.id
     LIMIT ${LARGEST}`
  );
  return [
    '## Land clip',
    '',
    `- Clipped lots: ${n('land.clipped')}, removing ${m2(n('land.removed_m2') / 10000)} ha`,
    `- Underwater lots: ${n('land.underwater')}, ${m2(n('land.underwater_m2') / 10000)} ha counted by their full area`,
    `- Grazing lots kept as they were (under the minimum removal): ${n('land.jitter_kept')}`,
    `- Dry area kept only because of buildings: ${m2(n('land.building_kept_m2'))} m²`,
    `- Lots not wholly inside the tiles read (the mask cannot speak for them): ${n('land.outside_tiles')}`,
    '',
    `The ${LARGEST} largest removals:`,
    '',
    mdTable(
      [
        'id',
        'neighbourhood',
        'land use',
        'status',
        'original m²',
        'dry m²',
        'removed m²',
        'removed %'
      ],
      rows.map((r) => [
        r.id,
        r.neighborhood,
        r.land_use ?? '—',
        r.status,
        m2(r.orig_m2),
        m2(r.dry_m2),
        m2(r.removed_m2),
        r.orig_m2 > 0 ? `${((100 * r.removed_m2) / r.orig_m2).toFixed(1)}%` : '—'
      ])
    ),
    ''
  ].join('\n');
}
