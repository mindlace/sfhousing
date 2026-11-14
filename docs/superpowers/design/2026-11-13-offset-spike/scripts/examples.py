"""Before/after shift for example buildings: footprint outline over the LiDAR height raster."""

import json
import os
import pickle
import sys

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import shapely
import shapely.affinity

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out')
FP = pickle.load(open(os.path.join(OUT, 'footprints.pkl'), 'rb'))
rows = {json.loads(l)['i']: json.loads(l) for l in open(os.path.join(OUT, 'fits.ndjson'))}
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze import accept  # noqa: E402  (re-runs the analysis printout)


def pick(cond):
  c = [r for r in rows.values() if 'error' not in r and accept(r['overture']) and cond(r)]
  c.sort(key=lambda r: -r['overture']['score'] / r['overture']['second'])
  return c[0]


ex = [
  ('OSM, low, aligned cluster', pick(lambda r: r['src'] == 'OpenStreetMap' and r['overture']['h_med'] < 12
                                     and np.hypot(r['overture']['dx'], r['overture']['dy']) < 0.3
                                     and r['overture']['area'] < 400)),
  ('OSM, low, ~1.3 m cluster', pick(lambda r: r['src'] == 'OpenStreetMap' and r['overture']['h_med'] < 12
                                    and 1.0 < r['overture']['dx'] < 1.6 and r['overture']['area'] < 400)),
  ('Microsoft ML', pick(lambda r: r['src'] == 'Microsoft ML Buildings')),
  ('OSM, tower', pick(lambda r: r['overture']['h_med'] > 60 and 'datasf' in r)),
]

fig, ax = plt.subplots(len(ex), 2, figsize=(12, 6 * len(ex)))
for k, (title, r) in enumerate(ex):
  z = np.load(os.path.join(OUT, 'rasters', f'{r["i"]}.npz'))
  hag = z['hag']
  x0, y0 = float(z['x0']), float(z['y0'])
  ny, nx = hag.shape
  ext = [x0, x0 + nx * 0.25, y0, y0 + ny * 0.25]
  g = shapely.from_wkb(FP['ov_wkb'][r['i']])
  p = r['overture']
  gs = shapely.affinity.translate(g, p['dx'], p['dy'])
  vmax = np.percentile(hag, 99)
  for c, (geom, lab) in enumerate([(g, 'as published'), (gs, f'shifted ({p["dx"]:+.2f}, {p["dy"]:+.2f}) m')]):
    a = ax[k, c]
    a.imshow(hag, origin='lower', extent=ext, cmap='gray', vmin=0, vmax=vmax)
    for poly in getattr(geom, 'geoms', [geom]):
      xs, ys = poly.exterior.xy
      a.plot(xs, ys, color='r' if c == 0 else 'c', lw=1.2)
    if 'datasf' in r and c == 1:
      d = r['datasf']
      gd = shapely.affinity.translate(shapely.from_wkb(FP['ds_wkb'][FP['ov_ds'][r['i']]]), d['dx'], d['dy'])
      for poly in getattr(gd, 'geoms', [gd]):
        xs, ys = poly.exterior.xy
        a.plot(xs, ys, color='y', lw=0.8, ls='--')
    b = g.bounds
    a.set_xlim(b[0] - 4, b[2] + 4)
    a.set_ylim(b[1] - 4, b[3] + 4)
    a.set_title(f'{title}: {lab}\nh={p["h_med"]:.1f} m, IoU {p["iou0"]:.2f} -> {p["iou"]:.2f}', fontsize=9)
    a.set_xticks([])
    a.set_yticks([])
fig.suptitle('Overture footprint (red as published, cyan shifted) over 2023 LiDAR height above ground;\n'
             'yellow dashed = DataSF footprint after its own fitted shift')
fig.tight_layout()
fig.savefig(os.path.join(OUT, 'fig', '6_examples.png'), dpi=80)
print([(t, r['i']) for t, r in ex])
