// Raster primitives over a RasterWindow's cell grid (row 0 = south).
import type { MultiPoly } from '../../geom.js';
import type { RasterWindow } from './mosaic.js';

/**
 * Cells whose centre, moved by (-dx, -dy), is inside the shape (even-odd across all rings). A
 * LiDAR frame offset d means the shape sits at footprint + d, so the cell at c reads footprint
 * place c - d.
 */
export function cellMask(w: RasterWindow, shape: MultiPoly, dx = 0, dy = 0): Uint8Array {
  const { nx, ny, res } = w;
  const mask = new Uint8Array(nx * ny);
  const edges: [number, number, number, number][] = [];
  for (const poly of shape)
    for (const ring of poly)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
        edges.push([ring[j][0], ring[j][1], ring[i][0], ring[i][1]]);
  for (let j = 0; j < ny; j++) {
    const y = w.y0 + (j + 0.5) * res - dy;
    const xs: number[] = [];
    for (const [xa, ya, xb, yb] of edges)
      if (ya > y !== yb > y) xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      // centres c with xs[k] <= c - dx < xs[k+1]
      const iA = Math.max(0, Math.ceil((xs[k] + dx - w.x0) / res - 0.5));
      const iB = Math.min(nx - 1, Math.ceil((xs[k + 1] + dx - w.x0) / res - 0.5) - 1);
      for (let i = iA; i <= iB; i++) mask[j * nx + i] = 1;
    }
  }
  return mask;
}

/** Sample at a continuous point; NaN outside the window or when a corner cell is NaN. */
export function bilinear(a: Float32Array, w: RasterWindow, x: number, y: number): number {
  const u = (x - w.x0) / w.res - 0.5;
  const v = (y - w.y0) / w.res - 0.5;
  if (u < -0.5 || v < -0.5 || u > w.nx - 0.5 || v > w.ny - 0.5) return NaN;
  const uc = Math.min(Math.max(u, 0), w.nx - 1);
  const vc = Math.min(Math.max(v, 0), w.ny - 1);
  const i = Math.min(Math.floor(uc), Math.max(0, w.nx - 2));
  const j = Math.min(Math.floor(vc), Math.max(0, w.ny - 2));
  const fu = uc - i;
  const fv = vc - j;
  const i1 = Math.min(i + 1, w.nx - 1);
  const j1 = Math.min(j + 1, w.ny - 1);
  return (
    a[j * w.nx + i] * (1 - fu) * (1 - fv) +
    a[j * w.nx + i1] * fu * (1 - fv) +
    a[j1 * w.nx + i] * (1 - fu) * fv +
    a[j1 * w.nx + i1] * fu * fv
  );
}

/**
 * Separable Gaussian, radius 3 sigma. NaN cells stay NaN; NaN neighbours and the window edge drop
 * out and the remaining weights renormalise.
 */
export function gaussian(
  a: Float32Array,
  nx: number,
  ny: number,
  sigmaCells: number
): Float32Array {
  if (sigmaCells <= 0) return Float32Array.from(a);
  const r = Math.max(1, Math.ceil(3 * sigmaCells));
  const k = new Float64Array(2 * r + 1);
  for (let t = -r; t <= r; t++) k[t + r] = Math.exp(-(t * t) / (2 * sigmaCells * sigmaCells));
  const pass = (src: Float32Array, horizontal: boolean): Float32Array => {
    const out = new Float32Array(src.length);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const c = src[j * nx + i];
        if (Number.isNaN(c)) {
          out[j * nx + i] = NaN;
          continue;
        }
        let s = 0;
        let ws = 0;
        for (let t = -r; t <= r; t++) {
          const ii = horizontal ? i + t : i;
          const jj = horizontal ? j : j + t;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
          const v = src[jj * nx + ii];
          if (Number.isNaN(v)) continue;
          s += v * k[t + r];
          ws += k[t + r];
        }
        out[j * nx + i] = s / ws;
      }
    return out;
  };
  return pass(pass(a, true), false);
}

/** Central differences per metre (one-sided at the edges); gy is per metre north. */
export function gradient(
  a: Float32Array,
  nx: number,
  ny: number,
  res: number
): { gx: Float32Array; gy: Float32Array } {
  const gx = new Float32Array(nx * ny);
  const gy = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const ia = Math.max(0, i - 1);
      const ib = Math.min(nx - 1, i + 1);
      const ja = Math.max(0, j - 1);
      const jb = Math.min(ny - 1, j + 1);
      gx[j * nx + i] = ib > ia ? (a[j * nx + ib] - a[j * nx + ia]) / ((ib - ia) * res) : 0;
      gy[j * nx + i] = jb > ja ? (a[jb * nx + i] - a[ja * nx + i]) / ((jb - ja) * res) : 0;
    }
  return { gx, gy };
}

/** 4-connected components of the nonzero cells; labels 1..n, 0 = background. */
export function label4(
  mask: Uint8Array,
  nx: number,
  ny: number
): { labels: Int32Array; n: number } {
  const labels = new Int32Array(nx * ny);
  let n = 0;
  const stack: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || labels[s]) continue;
    n++;
    labels[s] = n;
    stack.push(s);
    while (stack.length) {
      const c = stack.pop() as number;
      const i = c % nx;
      const j = (c - i) / nx;
      const visit = (q: number): void => {
        if (mask[q] && !labels[q]) {
          labels[q] = n;
          stack.push(q);
        }
      };
      if (i > 0) visit(c - 1);
      if (i < nx - 1) visit(c + 1);
      if (j > 0) visit(c - nx);
      if (j < ny - 1) visit(c + nx);
    }
  }
  return { labels, n };
}
