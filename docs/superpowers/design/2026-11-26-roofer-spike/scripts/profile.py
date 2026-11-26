"""Salesforce Tower taper: side elevations at one scale and plan area by height.

Left: orthographic side views (looking north, then looking west) of the LiDAR class-1 points, our
boxes, roofer on all points and roofer on the top-filtered points, all on the same axes.
Right: plan area against height. For the LiDAR, the convex hull of the class-1 points in each 4 m
band (the facade ring at that height). For a model, the area of 0.5 m cells whose top surface,
found by casting down, reaches that height. Both models are 2.5D, so that is their cross-section.
"""

import os
import sys

import geopandas as gpd
import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import shapely  # noqa: E402
from matplotlib.collections import PolyCollection  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import WORK  # noqa: E402
from compare import FIG, load_ours, load_points, load_roofer  # noqa: E402

fp = gpd.read_file(os.path.join(WORK, 'salesforce', 'footprints.gpkg'))
bid = fp.bid.iloc[0]
poly = fp.geometry.iloc[0]
ours = load_ours(fp)[bid]['mesh']
raw = load_roofer('salesforce')[bid]['mesh']['2.2']
top = load_roofer('salesforce_top')[bid]['mesh']['2.2']
g = load_roofer('salesforce')[bid]['attrs']['rf_h_ground']
pts = load_points('salesforce')
near = shapely.contains_xy(poly.buffer(3), pts[:, 0], pts[:, 1]) & (pts[:, 3] == 1) & (pts[:, 2] > g + 2)
p = pts[near]
c = np.array(poly.centroid.coords[0])

models = [('ours: boxes', ours), ('roofer, all points', raw), ('roofer, top-filtered', top)]
fig = plt.figure(figsize=(17, 9.5), dpi=120)
gs = fig.add_gridspec(2, 5, width_ratios=[1, 1, 1, 1, 2.2])
for row, (ax_i, name) in enumerate([(0, 'looking north'), (1, 'looking west')]):
  for col in range(4):
    ax = fig.add_subplot(gs[row, col])
    if col == 0:
      s = p[np.random.default_rng(0).choice(len(p), min(len(p), 60000), replace=False)]
      ax.scatter(s[:, ax_i] - c[ax_i], s[:, 2] - g, s=0.1, c='k', linewidths=0)
      ax.set_title(f'LiDAR, {name}', fontsize=9)
    else:
      t, m = models[col - 1]
      tri = m.vertices[m.faces]
      xy = np.stack([tri[:, :, ax_i] - c[ax_i], tri[:, :, 2] - g], axis=2)
      ax.add_collection(PolyCollection(xy, facecolors='0.55', edgecolors='none'))
      ax.set_title(f'{t}, {name}', fontsize=9)
    ax.set_xlim(-40, 40)
    ax.set_ylim(0, 340)
    ax.set_aspect('equal')
    ax.axhline(297, color='tab:red', lw=0.5, ls='--')
    ax.axhline(326, color='tab:blue', lw=0.5, ls='--')
    ax.tick_params(labelsize=7)
    if col == 0:
      ax.set_ylabel('m above ground', fontsize=8)

# Plan area by height
ax = fig.add_subplot(gs[:, 4])
zs = np.arange(4, 336, 4.0)
lid = []
for z in zs:
  b = p[(p[:, 2] - g >= z - 2) & (p[:, 2] - g < z + 2)]
  lid.append(shapely.MultiPoint(b[:, :2]).convex_hull.area if len(b) > 20 else np.nan)
ax.plot(lid, zs, 'k.', ms=3, label='LiDAR (hull of the points in each 4 m band)')
x0, y0, x1, y1 = poly.bounds
gx, gy = np.meshgrid(np.arange(x0 - 3, x1 + 3, 0.5), np.arange(y0 - 3, y1 + 3, 0.5))
o = np.column_stack([gx.ravel(), gy.ravel(), np.full(gx.size, 2000.0)])
d = np.tile([0, 0, -1.0], (len(o), 1))
for (t, m), col in zip(models, ['tab:orange', 'tab:green', 'tab:purple']):
  loc, idx, _ = m.ray.intersects_location(o, d, multiple_hits=False)
  ztop = np.full(len(o), -np.inf)
  ztop[idx] = loc[:, 2] - g
  area = np.array([(ztop >= z).sum() * 0.25 for z in zs])
  ax.plot(area, zs, color=col, lw=1.5, label=t)
  L = np.array(lid, float)
  for lo, hi in [(4, 330), (130, 330)]:
    k = (zs >= lo) & (zs <= hi) & ~np.isnan(L)
    print(f'{t}: mean |area - lidar| {lo}-{hi} m = {np.mean(np.abs(area[k] - L[k])):.0f} m2')
ax.axhline(297, color='tab:red', lw=0.5, ls='--', label='roof ~297 m')
ax.axhline(326, color='tab:blue', lw=0.5, ls='--', label='crown top 326 m')
ax.set_xlabel('plan area at that height (m²)')
ax.set_ylabel('m above ground')
ax.set_ylim(0, 340)
ax.legend(fontsize=8, loc='lower left')
ax.set_title('Salesforce Tower: plan area by height', fontsize=10)
fig.tight_layout()
fig.savefig(os.path.join(FIG, 'salesforce_profile.png'))
for z in [50, 150, 200, 220, 250, 280, 300, 320]:
  i = int(np.argmin(np.abs(zs - z)))
  print(z, 'lidar', round(lid[i] or 0))
