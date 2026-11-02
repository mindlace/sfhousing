// The /lesscars evidence dialog's data: every plan number with its evidence tier and source.
import type { LessCarsPlanFile, LessCarsSummary } from '$lib/data/lesscars/codec';
import type { CapacityKind, Param, PlanProject } from '$lib/data/lesscars/plan';
import { provenanceLines } from '$lib/fzp/provenance';
import { formatCount } from '$lib/scoreboard/format';
import type { Provenance } from '$lib/timelapse/types';
import { KIND_LABEL } from './timeline-view';

export interface EvidenceRow {
  name: string;
  value: string;
  prov: Provenance;
  lines: string[];
  invented: boolean;
}
export interface EvidenceSection {
  id: string;
  heading: string;
  rows: EvidenceRow[];
}

const CAPACITY_NAME: Record<CapacityKind, string> = {
  transit: 'Transit',
  street: 'Street',
  garage: 'Garage',
  housing: 'Housing'
};

export const evidenceSectionId = (projectId: string): string => `ev-${projectId}`;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function row(name: string, value: string, prov: Provenance, lines?: string[]): EvidenceRow {
  return {
    name,
    value,
    prov,
    lines: lines ?? provenanceLines(prov),
    invented: prov.tier === 4
  };
}

function months(p: Param): string {
  return `${formatCount(p.value)} ${plural(p.value, 'month', 'months')}`;
}

function projectRows(p: PlanProject): EvidenceRow[] {
  const rows = [row('Duration', months(p.durationMonths), p.durationMonths.provenance)];
  if ('peakTph' in p)
    rows.push(
      row('Peak trips per hour', `${formatCount(p.peakTph.value)} an hour`, p.peakTph.provenance)
    );
  if ('rowHalfWidthM' in p)
    rows.push(
      row(
        'Right-of-way half-width',
        `${formatCount(p.rowHalfWidthM.value)} m`,
        p.rowHalfWidthM.provenance
      )
    );
  if ('spaces' in p)
    rows.push(row('Spaces', `${formatCount(p.spaces.value)} spaces`, p.spaces.provenance));
  if ('build' in p && p.build)
    rows.push(
      row('Build duration', months(p.build.durationMonths), p.build.durationMonths.provenance)
    );
  if ('segments' in p)
    for (const s of p.segments) if ('line' in s) rows.push(row('Drawn geometry', '', s.provenance));
  return rows;
}

export function evidenceSections(f: LessCarsPlanFile, s: LessCarsSummary): EvidenceSection[] {
  const model = s.provenance;
  const modelLines = provenanceLines(model).filter(
    (l) => !/^(based on .* records|records from .*)$/.test(l)
  );
  modelLines.splice(
    Math.min(3, modelLines.length),
    0,
    `over ${formatCount(s.seeds)} paired futures`
  );
  const out: EvidenceSection[] = [
    {
      id: 'ev-model',
      heading: 'How the answer is computed',
      rows: [row('Extra homes by 2068', '', model, modelLines)]
    },
    {
      id: 'ev-capacity',
      heading: 'Construction capacity',
      rows: f.plan.capacity.map((c) =>
        row(`${CAPACITY_NAME[c.kind]} projects at once`, `${c.maxConcurrent} at once`, c.provenance)
      )
    }
  ];
  for (const p of f.plan.projects)
    out.push({
      id: evidenceSectionId(p.id),
      heading: `${p.label} (${KIND_LABEL[p.kind]})`,
      rows: projectRows(p)
    });
  return out;
}
