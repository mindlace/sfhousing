"""Close-up of a few neighbouring buildings: ours vs roofer, same camera.

Usage: zoom.py <set> <bid-prefix> <radius_m> <elev> <azim> <out-name>
Draws every building of <set> whose centroid lies within radius of the named building's.
"""

import os
import sys

import geopandas as gpd
import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import WORK  # noqa: E402
from compare import FIG, draw, limits, load_ours, load_roofer  # noqa: E402

name, prefix, radius, elev, azim, out = sys.argv[1:7]
radius, elev, azim = float(radius), float(elev), float(azim)
fp = gpd.read_file(os.path.join(WORK, name, 'footprints.gpkg'))
c = fp.geometry.centroid
i0 = int(np.where(fp.bid.str.startswith(prefix))[0][0])
sel = np.where(c.distance(c.iloc[i0]) < radius)[0]
fp = fp.iloc[sel].reset_index(drop=True)
rf = load_roofer(name)
ours = load_ours(fp)
bids = list(fp.bid)
rm = [rf.get(b, {}).get('mesh', {}).get('2.2') for b in bids]
rr = [rf.get(b, {}).get('roofmask', {}).get('2.2') for b in bids]
om = [ours[b]['mesh'] for b in bids]
orr = [ours[b]['roofmask'] for b in bids]
lo, hi = limits(rm + om, pad=1)
g = min(rf[b]['attrs']['rf_h_ground'] for b in bids if b in rf)
c0 = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, g])
lim = [(lo[0] - c0[0], hi[0] - c0[0]), (lo[1] - c0[1], hi[1] - c0[1]), (0, hi[2] - g)]
fig = plt.figure(figsize=(14, 6.5), dpi=140)
for k, (ms, rms, t) in enumerate([(om, orr, 'ours: boxes'), (rm, rr, f'roofer LoD2.2 ({name})')]):
  ax = fig.add_subplot(1, 2, k + 1, projection='3d')
  draw(ax, ms, rms, c0, lim, t)
  ax.view_init(elev=elev, azim=azim)
fig.subplots_adjust(left=0, right=1, bottom=0, top=0.95, wspace=0)
fig.savefig(os.path.join(FIG, out + '.png'))
print(out, len(bids), 'buildings')
