import type { ParcelId } from '$lib/data/parcel';
import type { TypologyId } from '$lib/generator';
import type { ChunkStatus, ParcelSummaryLike } from './types';

const nf = new Intl.NumberFormat('en-US');
const n = (v: number) => nf.format(v);
const plural = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`;

const LABELS: Record<Exclude<TypologyId, 'plex'>, string> = {
  adu: 'ADU',
  walkup: 'Walk-up',
  podium: '5-over-1',
  midrise: 'Mid-rise',
  tower: 'Tower'
};

export function typologyLabel(t: TypologyId, units: number): string {
  if (t === 'plex') return units === 1 ? 'House' : units === 2 ? 'Duplex' : 'Plex';
  return LABELS[t];
}

export type TooltipHit =
  | {
      kind: 'generated';
      parcelId: ParcelId;
      typology: TypologyId;
      stories: number;
      units: number;
      existingUnits: number;
    }
  | {
      kind: 'existing';
      parcelId: ParcelId | null;
      chunk: ChunkStatus | 'unknown';
      summary: ParcelSummaryLike | null;
    }
  | { kind: 'stop'; lines: [string, string] };

function generatedLines(
  parcelId: ParcelId,
  g: { typology: TypologyId; stories: number; units: number },
  existing: number
): [string, string] {
  const head = `Parcel ${parcelId}`;
  if (g.typology === 'adu') {
    return [
      head,
      `ADU · adds ${plural(g.units, 'unit', 'units')} to ${n(existing)} existing (net +${n(g.units)})`
    ];
  }
  const label = typologyLabel(g.typology, g.units);
  return [
    head,
    `${label} · ${plural(g.stories, 'story', 'stories')} · ${plural(g.units, 'unit', 'units')} · replaces ${n(existing)} (net +${n(g.units - existing)})`
  ];
}

export function tooltipLines(hit: TooltipHit): [string, string] {
  if (hit.kind === 'stop') return hit.lines;
  if (hit.kind === 'generated') return generatedLines(hit.parcelId, hit, hit.existingUnits);
  if (hit.parcelId === null) return ['Existing building', 'Not matched to a parcel'];
  const s = hit.summary;
  if (s?.generated) return generatedLines(hit.parcelId, s.generated, s.existingUnits);
  const head = `Parcel ${hit.parcelId}`;
  if (s) {
    const base = `Existing building · ${plural(s.existingUnits, 'unit', 'units')}`;
    if (s.underwater) return [head, `${base} · in the Bay`];
    return [head, s.eligible ? base : `${base} · not eligible for change`];
  }
  return [
    head,
    hit.chunk === 'error'
      ? 'Existing building · units unavailable'
      : 'Existing building · units loading…'
  ];
}
