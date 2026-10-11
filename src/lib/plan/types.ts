// Shared seam (I2–I4). Owned by plan-model. Shapes are fixed by the design's interface table; do not change them.

export interface Envelope {
  maxStories: number;
}

export type BrushStroke =
  | {
      kind: 'paint';
      stories: number /* integer 1..80 */;
      radiusM: number /* 5..500 */;
      path: [lng: number, lat: number][];
      id: string;
    }
  | { kind: 'erase'; radiusM: number; path: [lng: number, lat: number][]; id: string };

export type PlanOp = BrushStroke;

export interface Plan {
  schema: 1;
  datasetVersion: string;
  ops: PlanOp[];
  title?: string;
}
