// Shared seam (I11). Owned by scoreboard. Shapes are fixed by the design's interface table;
// do not change them. Marking: MC (net units against named targets; overshoot is meaningful).

export interface Target {
  id: string;
  label: string;
  units: number;
  range?: [low: number, high: number] /* M1 never sets; M2 affordability targets are ranges */;
  source: { label: string; url: string };
}

export interface TargetProgress {
  target: Target;
  fraction: number /* uncapped: 1.8 = 180% */;
}

export interface Score {
  grossUnits: number;
  demolishedUnits: number;
  netUnits: number;
  targets: TargetProgress[];
  parcelsChanged: number;
  byNeighborhood: Record<string, number>;
}
