"""Rasterize the USGS 3DEP San Francisco point cloud into raw sfhl/1 tile arrays.

  python -m sfh_lidar.rasterize --out <dir> --tiles <tx_ty,...> --size 500 --res 0.25
    --ground-res 1 --pad 20 --veg-frac 0.35 [--ept <url>] [--cache <dir>] [--las <file> ...]
    [--jobs 16] [--dry-run]

Tile (tx, ty) covers x in [tx*size, (tx+1)*size) and y in [ty*size, (ty+1)*size), EPSG:7131
metres. For each tile with points it writes <out>/<tx>_<ty>/{hag.i16, ground.i16, veg.u8,
tile.json}: raw little-endian arrays, row 0 south. hag and ground are centimetres (NAVD88 for
ground), -32768 = no data; veg is one byte (0 or 1) per hag cell. A tile without points writes
only tile.json with points 0. A finished tile directory is skipped, so a rerun resumes.

Per tile, over the tile plus `pad` on every side (the pad is cropped before writing):
- points come from the EPT nodes that intersect it (or from --las files, EPSG:3857 like the
  EPT), transformed EPSG:3857 -> EPSG:7131; classes 7 and 18 (noise) are dropped;
- DSM: the highest point per `res` cell; a hole within 1 m of a cell with points takes the
  nearest value, larger holes are no data;
- DTM: the lowest class-2 point per `ground-res` cell, linearly interpolated (nearest outside
  the convex hull of the ground cells), bilinearly resampled to `res` for hag = DSM - DTM;
- veg: any class 3-5 point in the cell, or (the share of first returns from multi-return pulses
  in a 5 x 5 cell window > veg-frac and hag > 1 m), then one binary opening.
"""

import argparse
import json
import os
import re
import shutil
import sys
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor

import laspy
import numpy as np
from pyproj import Transformer
from scipy import ndimage
from scipy.interpolate import griddata
from scipy.spatial import QhullError

from sfh_lidar.ept import Ept

EPT_URL = 'https://s3-us-west-2.amazonaws.com/usgs-lidar-public/CA_SanFrancisco_1_B23/ept.json'
NODATA = -32768
NOISE = (7, 18)
VEG_CLASSES = (3, 4, 5)
FILL_M = 1.0  # DSM holes within this distance of data take the nearest value
VEG_WINDOW = 5
VEG_MIN_HAG_M = 1.0
EDGE_M = 2.0  # margin (EPSG:3857 units) around the transformed bbox when selecting nodes

TO_7131 = Transformer.from_crs('EPSG:3857', 'EPSG:7131', always_xy=True)
FROM_7131 = Transformer.from_crs('EPSG:7131', 'EPSG:3857', always_xy=True)


class LasSource:
  """Local LAS/LAZ files in EPSG:3857 standing in for the EPT (tests)."""

  def __init__(self, paths):
    self.files = []
    for p in paths:
      with laspy.open(p) as f:
        h = f.header
        self.files.append((p, (h.mins[0], h.mins[1], h.maxs[0], h.maxs[1]), h.point_count))

  def nodes_for(self, bb):
    return [
      (p, n)
      for p, (x0, y0, x1, y1), n in self.files
      if not (x1 < bb[0] or x0 > bb[2] or y1 < bb[1] or y0 > bb[3])
    ]

  def node_path(self, key):
    return key


def _bbox_3857(b):
  """EPSG:3857 bbox covering the EPSG:7131 bbox b, plus EDGE_M."""
  xs = [b[0], b[2], b[0], b[2], (b[0] + b[2]) / 2, (b[0] + b[2]) / 2, b[0], b[2]]
  ys = [b[1], b[1], b[3], b[3], b[1], b[3], (b[1] + b[3]) / 2, (b[1] + b[3]) / 2]
  X, Y = FROM_7131.transform(xs, ys)
  return min(X) - EDGE_M, min(Y) - EDGE_M, max(X) + EDGE_M, max(Y) + EDGE_M


class Grids:
  """Per-cell accumulators over the padded window, filled node by node, so memory follows the
  cell count rather than the point count (a dense 500 m tile has over 20 million points)."""

  def __init__(self, bbox, n, res, gn, gres, inner):
    self.bbox, self.n, self.res, self.gn, self.gres, self.inner = bbox, n, res, gn, gres, inner
    self.dsm = np.full(n * n, -np.inf)
    self.first = np.zeros(n * n, np.int32)
    self.multi = np.zeros(n * n, np.int32)
    self.classed = np.zeros(n * n, bool)
    self.gmin = np.full(gn * gn, np.inf)
    self.points = 0  # points inside the unpadded tile

  def add(self, X, Y, z, cls, ret, nret):
    """Bin points (EPSG:7131, noise already dropped) that lie in the padded window."""
    x0, y0, x1, y1 = self.bbox
    k = (X >= x0) & (X < x1) & (Y >= y0) & (Y < y1)
    if not k.any():
      return
    px, py, z, cls, ret, nret = X[k] - x0, Y[k] - y0, z[k], cls[k], ret[k], nret[k]
    n, gn = self.n, self.gn
    lin = np.clip((py / self.res).astype(np.int64), 0, n - 1) * n + np.clip(
      (px / self.res).astype(np.int64), 0, n - 1
    )
    np.maximum.at(self.dsm, lin, z)
    first = ret == 1
    np.add.at(self.first, lin[first], 1)
    np.add.at(self.multi, lin[first & (nret > 1)], 1)
    self.classed[lin[np.isin(cls, VEG_CLASSES)]] = True
    g = cls == 2
    glin = np.clip((py[g] / self.gres).astype(np.int64), 0, gn - 1) * gn + np.clip(
      (px[g] / self.gres).astype(np.int64), 0, gn - 1
    )
    np.minimum.at(self.gmin, glin, z[g])
    lo, hi = self.inner
    self.points += int(np.count_nonzero((px >= lo) & (px < hi) & (py >= lo) & (py < hi)))


def read_into(grids, source, threads=8):
  """Stream the points of every node that intersects the window into grids."""
  x0, y0, x1, y1 = grids.bbox
  bb = _bbox_3857((x0, y0, x1, y1))
  keys = [k for k, _ in source.nodes_for(bb)]
  with ThreadPoolExecutor(threads) as pool:
    for p in pool.map(source.node_path, keys):  # downloads run ahead; reads stay in order
      las = laspy.read(p)
      x = np.asarray(las.x)
      y = np.asarray(las.y)
      m = (x >= bb[0]) & (x <= bb[2]) & (y >= bb[1]) & (y <= bb[3])
      m &= ~np.isin(np.asarray(las.classification), NOISE)
      if not m.any():
        continue
      X, Y = TO_7131.transform(x[m], y[m])
      grids.add(
        X,
        Y,
        np.asarray(las.z)[m],
        np.asarray(las.classification)[m],
        np.asarray(las.return_number)[m],
        np.asarray(las.number_of_returns)[m],
      )


def to_cm(v):
  """Metres -> int16 cm, rounded half away from zero, clamped to +-32767; NaN -> NODATA."""
  cm = v * 100.0
  r = np.sign(cm) * np.floor(np.abs(cm) + 0.5)
  r = np.clip(r, -32767, 32767)
  return np.where(np.isfinite(v), r, NODATA).astype('<i2')


def _resample(grid, f):
  """Bilinear resample of a cell-centred grid to f x finer cells (edges clamp)."""

  def axis_weights(n):
    u = (np.arange(n * f) + 0.5) / f - 0.5
    i0 = np.clip(np.floor(u).astype(int), 0, n - 1)
    i1 = np.clip(i0 + 1, 0, n - 1)
    w = np.clip(u - i0, 0.0, 1.0)
    return i0, i1, w

  r0, r1, wr = axis_weights(grid.shape[0])
  c0, c1, wc = axis_weights(grid.shape[1])
  cols = grid[:, c0] * (1 - wc) + grid[:, c1] * wc
  return cols[r0, :] * (1 - wr)[:, None] + cols[r1, :] * wr[:, None]


def _dtm(zmin, gn, gres):
  """Ground grid (gn x gn, row 0 south) from the per-cell ground minima; NaN when none."""
  have = np.flatnonzero(np.isfinite(zmin))
  if have.size == 0:
    return np.full((gn, gn), np.nan)
  sx = (have % gn + 0.5) * gres
  sy = (have // gn + 0.5) * gres
  sz = zmin[have]
  c = (np.arange(gn) + 0.5) * gres
  GX, GY = np.meshgrid(c, c)
  dtm = np.full((gn, gn), np.nan)
  if have.size >= 3:
    try:
      dtm = griddata((sx, sy), sz, (GX, GY), method='linear')
    except QhullError:
      pass  # collinear or degenerate samples: nearest below
  if np.isnan(dtm).any():
    nn = griddata((sx, sy), sz, (GX, GY), method='nearest')
    dtm = np.where(np.isnan(dtm), nn, dtm)
  return dtm


def raster(grids, veg_frac):
  """hag (m, NaN = no data), ground (m) and veg (bool) over the padded window."""
  n, res, gn, gres = grids.n, grids.res, grids.gn, grids.gres
  dsm = grids.dsm.reshape(n, n)
  hole = ~np.isfinite(dsm)
  if hole.any():
    dist, (ii, jj) = ndimage.distance_transform_edt(hole, sampling=res, return_indices=True)
    dsm = np.where(dist <= FILL_M + 1e-9, dsm[ii, jj], np.nan)
    del ii, jj, dist

  ground = _dtm(grids.gmin, gn, gres)
  hag = dsm - _resample(ground, int(round(gres / res)))

  def window(a):
    return ndimage.uniform_filter(a.reshape(n, n).astype(np.float64), VEG_WINDOW, mode='nearest')

  cnt = window(grids.first)
  multi = window(grids.multi)
  frac = multi / np.maximum(cnt, 1.0 / VEG_WINDOW**2)
  with np.errstate(invalid='ignore'):
    tall = hag > VEG_MIN_HAG_M
  veg = grids.classed.reshape(n, n) | ((frac > veg_frac) & tall)
  veg = ndimage.binary_opening(veg, iterations=1)
  return hag, ground, veg


def parse_tiles(s):
  """'tx_ty,tx_ty,...' -> [(tx, ty), ...]."""
  out = []
  for t in filter(None, (t.strip() for t in s.split(','))):
    m = re.fullmatch(r'(-?\d+)_(-?\d+)', t)
    if not m:
      raise argparse.ArgumentTypeError(f'bad tile {t!r}: expected tx_ty')
    out.append((int(m[1]), int(m[2])))
  return out


def _layout(args):
  n_in = int(round(args.size / args.res))
  g_in = int(round(args.size / args.ground_res))
  p = int(round(args.pad / args.res))
  gp = int(round(args.pad / args.ground_res))
  return n_in, g_in, p, gp


def _meta(args, tx, ty, points):
  n_in, g_in, _, _ = _layout(args)
  return {
    'tx': tx,
    'ty': ty,
    'sizeM': args.size,
    'res': args.res,
    'groundRes': args.ground_res,
    'nx': n_in,
    'ny': n_in,
    'gnx': g_in,
    'gny': g_in,
    'points': int(points),
  }


def _source(args):
  return LasSource(args.las) if args.las else Ept(args.ept, args.cache)


def _padded(args, tx, ty):
  x0 = tx * args.size - args.pad
  y0 = ty * args.size - args.pad
  w = args.size + 2 * args.pad
  return (x0, y0, x0 + w, y0 + w)


def rasterize_tile(args, tx, ty, source=None):
  """Write one tile's directory; returns its point count (0 = only tile.json)."""
  name = f'{tx}_{ty}'
  final = os.path.join(args.out, name)
  if os.path.exists(os.path.join(final, 'tile.json')):
    with open(os.path.join(final, 'tile.json')) as f:
      return json.load(f)['points']
  source = source or _source(args)
  n_in, g_in, p, gp = _layout(args)
  grids = Grids(
    _padded(args, tx, ty),
    n_in + 2 * p,
    args.res,
    g_in + 2 * gp,
    args.ground_res,
    (args.pad, args.pad + args.size),
  )
  read_into(grids, source, args.threads)
  inner = grids.points
  tmp = os.path.join(args.out, f'.{name}.tmp')
  shutil.rmtree(tmp, ignore_errors=True)
  os.makedirs(tmp)
  if inner > 0:
    hag, ground, veg = raster(grids, args.veg_frac)
    to_cm(hag[p : p + n_in, p : p + n_in]).tofile(os.path.join(tmp, 'hag.i16'))
    to_cm(ground[gp : gp + g_in, gp : gp + g_in]).tofile(os.path.join(tmp, 'ground.i16'))
    veg[p : p + n_in, p : p + n_in].astype(np.uint8).tofile(os.path.join(tmp, 'veg.u8'))
  with open(os.path.join(tmp, 'tile.json'), 'w') as f:
    json.dump(_meta(args, tx, ty, inner), f)
  shutil.rmtree(final, ignore_errors=True)
  os.replace(tmp, final)
  return inner


def _work(job):
  args, tx, ty = job
  return tx, ty, rasterize_tile(args, tx, ty)


def build_parser():
  ap = argparse.ArgumentParser(
    prog='python -m sfh_lidar.rasterize', description=__doc__.split('\n')[0]
  )
  ap.add_argument('--out', required=True)
  ap.add_argument('--tiles', required=True, type=parse_tiles, help='tx_ty,tx_ty,...')
  ap.add_argument('--size', type=float, default=500)
  ap.add_argument('--res', type=float, default=0.25)
  ap.add_argument('--ground-res', type=float, default=1)
  ap.add_argument('--pad', type=float, default=20)
  ap.add_argument('--veg-frac', type=float, default=0.35)
  ap.add_argument('--ept', default=EPT_URL)
  ap.add_argument('--cache', help='EPT metadata, hierarchy and node cache (required with --ept)')
  ap.add_argument('--las', nargs='+', help='EPSG:3857 LAS/LAZ files used instead of the EPT')
  ap.add_argument('--jobs', type=int, default=1, help='tiles rasterized in parallel (processes)')
  ap.add_argument('--threads', type=int, default=8, help='node downloads in parallel per tile')
  ap.add_argument('--dry-run', action='store_true')
  return ap


def _int_or_float(v):
  return int(v) if float(v).is_integer() else v


def main(argv=None):
  ap = build_parser()
  args = ap.parse_args(argv)
  if not args.las and not args.cache:
    ap.error('--cache is required when reading the EPT')
  args.size = _int_or_float(args.size)
  args.ground_res = _int_or_float(args.ground_res)
  args.pad = _int_or_float(args.pad)
  ratios = {
    'size/res': args.size / args.res,
    'size/ground-res': args.size / args.ground_res,
    'pad/res': args.pad / args.res,
    'pad/ground-res': args.pad / args.ground_res,
    'ground-res/res': args.ground_res / args.res,
  }
  for what, v in ratios.items():
    if abs(v - round(v)) > 1e-9:
      ap.error(f'{what} must be a whole number of cells')

  if args.dry_run:
    source = _source(args)
    for tx, ty in args.tiles:
      nodes = source.nodes_for(_bbox_3857(_padded(args, tx, ty)))
      print(f'tile {tx}_{ty} nodes {len(nodes)} points {sum(c for _, c in nodes)}', flush=True)
    return 0

  os.makedirs(args.out, exist_ok=True)
  total = len(args.tiles)
  if args.jobs <= 1 or total <= 1:
    source = _source(args)
    done = ((tx, ty, rasterize_tile(args, tx, ty, source)) for tx, ty in args.tiles)
    for i, (tx, ty, pts) in enumerate(done, 1):
      print(f'tile {tx}_{ty} points {pts} ({i}/{total})', flush=True)
  else:
    if not args.las:
      _source(args)  # fetch ept.json and the root hierarchy once, before the workers start
    with ProcessPoolExecutor(args.jobs) as pool:
      jobs = [(args, tx, ty) for tx, ty in args.tiles]
      for i, (tx, ty, pts) in enumerate(pool.map(_work, jobs), 1):
        print(f'tile {tx}_{ty} points {pts} ({i}/{total})', flush=True)
  return 0


if __name__ == '__main__':
  # Run through the importable module so worker processes can unpickle _work.
  from sfh_lidar import rasterize as _self

  sys.exit(_self.main())
