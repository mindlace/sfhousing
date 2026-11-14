// Street-facing test for building faces (spec "False front"): is there a public centreline in
// front of a face, within reach and inside a cone about its outward normal?
import type { Ring } from '../../geom.js';

const CELL = 32;

/** Centreline segments bucketed on a CELL-metre grid by their bounding boxes. */
export class StreetIndex {
  private segs: number[] = [];
  private grid = new Map<string, number[]>();

  /** Public centrelines as open polylines, EPSG:7131 metres. */
  constructor(lines: Ring[]) {
    for (const line of lines)
      for (let i = 0; i + 1 < line.length; i++) {
        const [ax, ay] = line[i];
        const [bx, by] = line[i + 1];
        if (ax === bx && ay === by) continue;
        const s = this.segs.length / 4;
        this.segs.push(ax, ay, bx, by);
        for (
          let gx = Math.floor(Math.min(ax, bx) / CELL);
          gx <= Math.floor(Math.max(ax, bx) / CELL);
          gx++
        )
          for (
            let gy = Math.floor(Math.min(ay, by) / CELL);
            gy <= Math.floor(Math.max(ay, by) / CELL);
            gy++
          ) {
            const key = `${gx},${gy}`;
            const list = this.grid.get(key);
            if (list) list.push(s);
            else this.grid.set(key, [s]);
          }
      }
  }

  /**
   * True when, for some centreline segment, its point p nearest to mid has |p - mid| <= maxDist
   * and (p - mid) . n >= minCos |p - mid| (n the outward normal). The nearest point, not any point
   * in the cone: the side street of a corner building passes within reach of its rear face at 45
   * degrees, but its nearest point is beside that face.
   */
  facing(mid: [number, number], n: [number, number], maxDist: number, minCos: number): boolean {
    const [mx, my] = mid;
    const nl = Math.hypot(n[0], n[1]);
    if (!(nl > 0)) return false;
    const ux = n[0] / nl;
    const uy = n[1] / nl;
    const seen = new Set<number>();
    for (let gx = Math.floor((mx - maxDist) / CELL); gx <= Math.floor((mx + maxDist) / CELL); gx++)
      for (
        let gy = Math.floor((my - maxDist) / CELL);
        gy <= Math.floor((my + maxDist) / CELL);
        gy++
      )
        for (const s of this.grid.get(`${gx},${gy}`) ?? []) {
          if (seen.has(s)) continue;
          seen.add(s);
          if (this.segFacing(s, mx, my, ux, uy, maxDist, minCos)) return true;
        }
    return false;
  }

  private segFacing(
    s: number,
    mx: number,
    my: number,
    ux: number,
    uy: number,
    maxDist: number,
    minCos: number
  ): boolean {
    const px = this.segs[4 * s] - mx;
    const py = this.segs[4 * s + 1] - my;
    const dx = this.segs[4 * s + 2] - this.segs[4 * s];
    const dy = this.segs[4 * s + 3] - this.segs[4 * s + 1];
    const t = Math.max(0, Math.min(1, -(px * dx + py * dy) / (dx * dx + dy * dy)));
    const ax = px + t * dx;
    const ay = py + t * dy;
    const r = Math.hypot(ax, ay);
    if (r > maxDist) return false;
    if (r < 1e-9) return true;
    return ax * ux + ay * uy >= minCos * r;
  }
}
