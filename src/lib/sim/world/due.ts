import type { Due } from './types';

/**
 * What is due in which model month (S11). Not part of the world: it holds a map and may be
 * rebuilt at any time by `planDue`. An entity is due in at most one month; nothing is kept past
 * `through`.
 */
export class DueList implements Due {
  private readonly month = new Map<number, number>();
  private readonly buckets = new Map<number, number[]>();

  constructor(readonly through: number) {}

  /** Entities due in `month`, ascending; they are forgotten. */
  take(month: number): Int32Array {
    const bucket = this.buckets.get(month);
    if (!bucket) return new Int32Array(0);
    this.buckets.delete(month);
    const live: number[] = [];
    for (const e of bucket) if (this.month.get(e) === month) live.push(e);
    live.sort((a, b) => a - b);
    const out: number[] = [];
    for (let i = 0; i < live.length; i++) {
      if (i > 0 && live[i] === live[i - 1]) continue;
      out.push(live[i]);
      this.month.delete(live[i]);
    }
    return Int32Array.from(out);
  }

  /** Makes `entity` due in `month`, replacing any earlier month; nothing after `through`. */
  put(entity: number, month: number): void {
    if (month > this.through) {
      this.month.delete(entity);
      return;
    }
    this.month.set(entity, month);
    const bucket = this.buckets.get(month);
    if (bucket) bucket.push(entity);
    else this.buckets.set(month, [entity]);
  }

  drop(entity: number): void {
    this.month.delete(entity);
  }
}
