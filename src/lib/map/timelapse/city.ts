// The citywide feed's marker store on the page (`CityStore`): the rows `TimelineUpdate.city`
// fills, by world row. Pure. Activity reads it; nothing draws from it.
import { validateCityDelta } from '../city-delta';
import type { CityDelta } from '../types';

/** The page's markers, by row: typed arrays grown on demand, one entry per world row. */
export class CityStore {
  #cap = 0;
  #length = 0;
  #size = 0;
  #flagged = 0;
  #lngLat = new Float32Array(0);
  #days = new Float32Array(0);
  #homes = new Uint16Array(0);
  #existing = new Uint16Array(0);
  #flags = new Uint8Array(0);
  #has = new Uint8Array(0);

  /** Rows holding a marker. */
  get size(): number {
    return this.#size;
  }
  /** Of them, with a flag. */
  get flagged(): number {
    return this.#flagged;
  }
  /** The row bound: every marker is at a row below it. */
  get length(): number {
    return this.#length;
  }
  /** Views by row, valid until the next `apply` or `clear`. */
  get lngLat(): Float32Array {
    return this.#lngLat;
  }
  get days(): Float32Array {
    return this.#days;
  }
  get homes(): Uint16Array {
    return this.#homes;
  }
  /** Per row: the homes the project replaces (CityDelta.existing). A view, valid until the next `apply` or `clear`. */
  get existing(): Uint16Array {
    return this.#existing;
  }
  get flags(): Uint8Array {
    return this.#flags;
  }
  get has(): Uint8Array {
    return this.#has;
  }

  /**
   * replace: revision 0 (the delta is the whole set); else forget markers at or past d.from
   * (when present), drop those at or past d.rows, then write its rows. Validates first
   * (validateCityDelta): a malformed delta throws and leaves the store as it was.
   */
  apply(d: CityDelta, replace: boolean): void {
    validateCityDelta(d);
    if (replace) this.clear();
    else if (d.from !== undefined) this.#forget(d.from);
    this.#forget(d.rows);
    this.#reserve(d.rows);
    this.#length = d.rows;
    for (let i = 0; i < d.row.length; i++) {
      const r = d.row[i];
      if (this.#has[r]) {
        if (this.#flags[r]) this.#flagged--;
      } else {
        this.#has[r] = 1;
        this.#size++;
      }
      this.#lngLat[2 * r] = d.lngLat[2 * i];
      this.#lngLat[2 * r + 1] = d.lngLat[2 * i + 1];
      this.#days[3 * r] = d.days[3 * i];
      this.#days[3 * r + 1] = d.days[3 * i + 1];
      this.#days[3 * r + 2] = d.days[3 * i + 2];
      this.#homes[r] = d.homes[i];
      this.#existing[r] = d.existing[i];
      this.#flags[r] = d.flags[i];
      if (d.flags[i]) this.#flagged++;
    }
  }

  clear(): void {
    this.#has.fill(0);
    this.#length = 0;
    this.#size = 0;
    this.#flagged = 0;
  }

  /** Forgets every marker at row >= k. */
  #forget(k: number): void {
    for (let r = k; r < this.#length; r++) {
      if (!this.#has[r]) continue;
      this.#has[r] = 0;
      this.#size--;
      if (this.#flags[r]) this.#flagged--;
    }
    this.#length = Math.min(this.#length, k);
  }

  #reserve(n: number): void {
    if (n <= this.#cap) return;
    const cap = Math.max(n, 2 * this.#cap);
    const grow = <T extends Float32Array | Uint16Array | Uint8Array>(a: T, w: number, b: T): T => {
      b.set(a.subarray(0, this.#cap * w));
      return b;
    };
    this.#lngLat = grow(this.#lngLat, 2, new Float32Array(2 * cap));
    this.#days = grow(this.#days, 3, new Float32Array(3 * cap));
    this.#homes = grow(this.#homes, 1, new Uint16Array(cap));
    this.#existing = grow(this.#existing, 1, new Uint16Array(cap));
    this.#flags = grow(this.#flags, 1, new Uint8Array(cap));
    this.#has = grow(this.#has, 1, new Uint8Array(cap));
    this.#cap = cap;
  }
}
