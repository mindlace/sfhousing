// The evidence types every sourced constant uses. They live here, not in the /sim page's folder,
// so the finance model (and the pipeline, which imports it by path) needs no `$lib` import.
import type { Provenance } from '../../timelapse/types';

export interface Sourced<T> {
  value: T;
  provenance: Provenance;
}
export interface Unsourced {
  value: null;
  reason: string;
}
export type Evidence<T> = Sourced<T> | Unsourced;
