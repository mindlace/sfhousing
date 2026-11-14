"""Rowhouse blocks: does a predicted offset line the street wall up with the LiDAR?

For each block: published footprints, the best global (height, position) model's prediction, a
two-frame per-building choice, and a rigid fit of the whole block. Facade metric: for every
sample on the exterior of the block's footprint union, the distance along the outward normal to
the strongest downward height edge (within +-2.5 m); reported as median |distance|."""

import os
import pickle
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import pyproj
import shapely
import shapely.affinity
from scipy import ndimage

import fitlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out')
FP = pickle.load(open(os.path.join(OUT, 'footprints.pkl'), 'rb'))
FR = pickle.load(open(os.path.join(OUT, 'osm_frames.pkl'), 'rb'))['C']
CONST = (0.65, -0.08)  # best global OSM model (constant; height terms add nothing), analyze.py
T = pyproj.Transformer.from_crs('EPSG:4326', 'EPSG:7131', always_xy=True)
ov = shapely.from_wkb(FP['ov_wkb'])
tree = shapely.STRtree(ov)
cent = shapely.centroid(ov)

BLOCKS = [
  ('Outer Sunset rowhouse block (densest attached window)', -122.49858, 37.7542, 40, 95),
  ('Noe Valley, 24th-25th St / Noe-Sanchez', -122.4310, 37.7505, 95, 45),
  ('Inner Richmond, 5th-6th Ave / Cabrillo-Fulton', -122.4635, 37.7740, 40, 95),
]


def edge_dist(r, gx, gy, geom):
  P, N = fitlib.boundary_samples(geom, step=0.25)
  ts = np.arange(-2.5, 2.51, 0.05)
  cols = (P[:, None, 0] + ts[None] * N[:, None, 0] - r['x0']) / fitlib.RES - 0.5
  rows = (P[:, None, 1] + ts[None] * N[:, None, 1] - r['y0']) / fitlib.RES - 0.5
  a = ndimage.map_coordinates(gx, [rows.ravel(), cols.ravel()], order=1).reshape(cols.shape)
  b = ndimage.map_coordinates(gy, [rows.ravel(), cols.ravel()], order=1).reshape(cols.shape)
  v = -(a * N[:, None, 0] + b * N[:, None, 1])
  k = v.argmax(1)
  strong = v.max(1) > 0.4
  return ts[k][strong], P[strong]


results = []
for bi, (name, lon, lat, hx, hy) in enumerate(BLOCKS):
  fig, axes = plt.subplots(1, 4, figsize=(24, 9))
  x, y = T.transform(lon, lat)
  box = shapely.box(x - hx, y - hy, x + hx, y + hy)
  idx = [i for i in tree.query(box) if box.contains(cent[i]) and ov[i].area > 25]
  geoms = ov[idx]
  srcs = FP['ov_src'][idx]
  bb = np.array(shapely.bounds(shapely.union_all(geoms)))
  r = fitlib.hag_raster((bb[0] - 10, bb[1] - 10, bb[2] + 10, bb[3] + 10))
  m0 = np.zeros((r['ny'], r['nx']), bool)
  for g in geoms:
    m0 |= fitlib.mask_of(g, r)
  href = float(np.median(r['hag'][m0]))
  hn, gx, gy = fitlib.prepare(r, href)
  union = shapely.union_all(shapely.buffer(geoms, 0.05)).buffer(-0.05)

  # rigid block fit (all footprint boundaries together)
  shifts, S = fitlib.score_grid(r, gx, gy, shapely.MultiPolygon(
    [p for g in geoms for p in getattr(g, 'geoms', [g])]))
  blk = fitlib.analyse_peak(shifts, S)
  # per-building free fits and two-frame choice
  per, two = [], []
  for g in geoms:
    sh, Sg = fitlib.score_grid(r, gx, gy, g)
    pk = fitlib.analyse_peak(sh, Sg)
    per.append((pk['dx'], pk['dy'], pk['second'] / pk['score']))
    sc = []
    for c in FR:
      i0 = np.argmin(np.abs(sh - c[0]))
      j0 = np.argmin(np.abs(sh - c[1]))
      sc.append(Sg[j0, i0])
    two.append(FR[int(np.argmax(sc))])
  per = np.array(per)
  two = np.array(two)

  opts = {
    'published': [(0.0, 0.0)] * len(geoms),
    'const model': [CONST] * len(geoms),
    'two-frame pick': [tuple(t) for t in two],
    'block rigid fit': [(blk['dx'], blk['dy'])] * len(geoms),
  }
  row = dict(block=name, n=len(geoms), src={s: int((srcs == s).sum()) for s in set(srcs)},
             block_fit=(round(blk['dx'], 2), round(blk['dy'], 2), round(blk['second'] / blk['score'], 2)),
             per_building_free=dict(
               median=np.median(per[:, :2], 0).round(2).tolist(),
               iqr=np.subtract(*np.percentile(per[:, :2], [75, 25], axis=0)).round(2).tolist(),
               ambiguous_share=float(np.mean(per[:, 2] > 0.85))),
             two_frame_share_frame1=float(np.mean(two[:, 0] > 0.6)))
  for c, (oname, sh) in enumerate(opts.items()):
    moved = [shapely.affinity.translate(g, dx, dy) for g, (dx, dy) in zip(geoms, sh)]
    un = shapely.union_all(shapely.buffer(moved, 0.05)).buffer(-0.05)
    d, P = edge_dist(r, gx, gy, un)
    row[oname] = dict(median_abs_edge_m=round(float(np.median(np.abs(d))), 2),
                      share_within_0_3=round(float(np.mean(np.abs(d) <= 0.3)), 2))
    a = axes[c]
    ext = [r['x0'], r['x0'] + r['nx'] * 0.25, r['y0'], r['y0'] + r['ny'] * 0.25]
    a.imshow(r['hag'], origin='lower', extent=ext, cmap='gray', vmin=0, vmax=np.percentile(r['hag'], 99))
    for g in moved:
      for p in getattr(g, 'geoms', [g]):
        xs, ys = p.exterior.xy
        a.plot(xs, ys, color='r' if c == 0 else 'c', lw=0.7)
    sc = a.scatter(P[:, 0], P[:, 1], c=np.clip(d, -1.5, 1.5), cmap='coolwarm', s=2, vmin=-1.5, vmax=1.5)
    # zoom: 50 m window at the block centre so facades are readable
    a.set_xlim(x - 25, x + 25)
    a.set_ylim(y - 25, y + 25)
    a.set_xticks([])
    a.set_yticks([])
    a.set_title(f'{name}\n{oname}: median |edge gap| {row[oname]["median_abs_edge_m"]:.2f} m, '
                f'<=0.3 m {row[oname]["share_within_0_3"]:.0%}', fontsize=9)
  results.append(row)
  print(row)
  fig.colorbar(sc, ax=axes, shrink=0.6,
               label='gap from footprint-union edge to LiDAR height edge (m, + outward)')
  fig.savefig(os.path.join(OUT, 'fig', f'7{"abc"[bi]}_rowhouse_block.png'), dpi=110,
              bbox_inches='tight')
  plt.close(fig)
