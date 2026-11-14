"""Scatter, direction, quiver and residual figures."""

import os
import pickle
import sys

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import shapely

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out')
FIG = os.path.join(OUT, 'fig')
os.makedirs(FIG, exist_ok=True)
T = pickle.load(open(os.path.join(OUT, 'tables.pkl'), 'rb'))
OV, DS, X0, Y0 = T['OV'], T['DS'], T['X0'], T['Y0']
FP = pickle.load(open(os.path.join(OUT, 'footprints.pkl'), 'rb'))
recs = pickle.load(open(os.path.join(OUT, 'ov_sources.pkl'), 'rb'))

import analyze as am  # noqa: E402  (re-runs the analysis printout)


def sub(t, m):
  return {k: v[m] for k, v in t.items()}


ovk = sub(OV, OV['ok'])
isml = ovk['src'] == 'Microsoft ML Buildings'
osm = sub(ovk, ~isml)
ml = sub(ovk, isml)
dsk = sub(DS, DS['ok'])
SETS = [('Overture, OSM geometry', osm, 'C0'), ('Overture, Microsoft ML geometry', ml, 'C1'),
        ('DataSF ynuv-fyni', dsk, 'C2')]

# ---------------- 1. scatter vs height
fig, ax = plt.subplots(3, 3, figsize=(15, 12), sharex=True)
for c, (name, t, col) in enumerate(SETS):
  for r, (k, lab) in enumerate([('dx', 'dx east (m)'), ('dy', 'dy north (m)'), (None, '|d| (m)')]):
    v = np.hypot(t['dx'], t['dy']) if k is None else t[k]
    ax[r, c].scatter(t['h'], v, s=10, alpha=0.6, color=col)
    ax[r, c].set_xscale('log')
    ax[r, c].axhline(0, color='k', lw=0.5)
    ax[r, c].grid(alpha=0.3)
    ax[r, c].set_ylim(-3.1 if k else 0, 3.1)
    if c == 0:
      ax[r, c].set_ylabel(lab)
  ax[0, c].set_title(f'{name} (n={len(t["h"])})')
  ax[2, c].set_xlabel('LiDAR roof height above ground, median (m)')
fig.suptitle('Shift that moves each footprint onto the 2023 LiDAR, vs building height')
fig.tight_layout()
fig.savefig(os.path.join(FIG, '1_offset_vs_height.png'), dpi=110)
plt.close(fig)

# ---------------- 2. direction distribution
fig, ax = plt.subplots(1, 3, figsize=(15, 5), subplot_kw=dict(projection='polar'))
for c, (name, t, col) in enumerate(SETS):
  ang = np.arctan2(t['dy'], t['dx'])
  mag = np.hypot(t['dx'], t['dy'])
  for lo, hi, cc in [(0, 10, 'C0'), (10, 30, 'C1'), (30, 500, 'C3')]:
    m = (t['h'] >= lo) & (t['h'] < hi)
    ax[c].scatter(ang[m], mag[m], s=12, alpha=0.7, color=cc, label=f'h {lo}-{hi} m')
  ax[c].set_rmax(3)
  ax[c].set_title(name, pad=14)
  ax[c].legend(loc='lower left', fontsize=8, bbox_to_anchor=(-0.15, -0.15))
fig.suptitle('Shift direction (angle, 0 = east, counter-clockwise) and size (radius, m)')
fig.tight_layout()
fig.savefig(os.path.join(FIG, '2_direction.png'), dpi=110)
plt.close(fig)

# ---------------- 3. quiver maps
allc = shapely.centroid(shapely.from_wkb(FP['ov_wkb'][::7]))
bx, by = shapely.get_x(allc), shapely.get_y(allc)
SCALE = 500  # map metres per metre of shift
t0x, t0y = OV['x'].min(), OV['y'].max() + 300


def quiver(ax, t, title, color_by='h', dx=None, dy=None, vmax=60):
  dx = t['dx'] if dx is None else dx
  dy = t['dy'] if dy is None else dy
  ax.scatter(bx, by, s=0.2, color='0.85', zorder=0)
  q = ax.quiver(t['x'], t['y'], dx * SCALE, dy * SCALE, t[color_by] if color_by else 'k',
                angles='xy', scale_units='xy', scale=1, width=0.003, cmap='viridis',
                clim=(0, vmax) if color_by else None)
  ax.scatter(t['x'], t['y'], s=3, color='k')
  ax.quiver([t0x], [t0y], [SCALE], [0], angles='xy', scale_units='xy', scale=1, width=0.003,
            color='r')
  ax.text(t0x, t0y + 200, '1 m', color='r')
  ax.set_aspect('equal')
  ax.set_title(title)
  ax.set_xticks([])
  ax.set_yticks([])
  return q


XL = (OV['x'].min() - 800, OV['x'].max() + 800)
YL = (OV['y'].min() - 800, OV['y'].max() + 800)


def mapfig(path, t, title, **kw):
  fig, ax = plt.subplots(figsize=(12, 11))
  q = quiver(ax, t, title, **kw)
  ax.set_xlim(*XL)
  ax.set_ylim(*YL)
  fig.colorbar(q, ax=ax, label='roof height (m)', shrink=0.7)
  fig.savefig(os.path.join(FIG, path), dpi=90, bbox_inches='tight')
  plt.close(fig)


for c, (name, t, col) in enumerate(SETS):
  mapfig(f'3{"abc"[c]}_quiver_map.png', t,
         f'{name}: shift onto LiDAR (n={len(t["h"])}), arrow 1 m = {SCALE} m')

# ---------------- 4. residual maps after the best global model per source
for c, (name, t, model) in enumerate([('Overture OSM', osm, 'const'), ('Overture ML', ml, 'const'),
                                       ('DataSF', dsk, 'nadir1')]):
  ex, ey = am.cv(t, model)
  mapfig(f'4{"abc"[c]}_residual_map.png', t,
         f'{name}: residual after {model} model (CV rms {am.rms(ex, ey):.2f} m)', dx=ex, dy=ey)

# ---------------- 4b. OSM: offsets coloured by OSM way-id era (lineage)
wid = []
for k in range(len(OV['i'])):
  d, rid, ut = recs[k]
  wid.append(int(rid[1:].split('@')[0]) if d == 'OpenStreetMap' and rid else -1)
wid = np.array(wid)[OV['ok']][~isml]
fig, ax = plt.subplots(1, 2, figsize=(16, 7))
era = np.where(wid < 2e8, 0, np.where(wid < 3e8, 1, 2))
for e, lab, cc in [(0, 'way id < 200M (<=2013)', 'C0'), (1, '200-300M (2013-14 import era)', 'C1'),
                   (2, '> 300M (2015+)', 'C3')]:
  m = era == e
  ax[0].scatter(osm['dx'][m], osm['dy'][m], s=12, color=cc, label=f'{lab} n={m.sum()}', alpha=0.7)
ax[0].axhline(0, color='k', lw=0.5)
ax[0].axvline(0, color='k', lw=0.5)
ax[0].plot([1.34], [-0.38], 'k+', ms=15, mew=2)
ax[0].text(1.4, -0.5, 'NAD83(2011)->WGS84\ndatum shift (epoch 2010)', fontsize=8)
ax[0].set_xlim(-3, 3)
ax[0].set_ylim(-3, 3)
ax[0].set_aspect('equal')
ax[0].legend(fontsize=8)
ax[0].set_xlabel('dx east (m)')
ax[0].set_ylabel('dy north (m)')
ax[0].set_title('OSM footprints: shift onto LiDAR by OSM lineage')
for s, (name, t, col) in enumerate(SETS[1:]):
  ax[1].scatter(t['dx'], t['dy'], s=12, color=col, alpha=0.6, label=name)
ax[1].plot([1.34], [-0.38], 'k+', ms=15, mew=2)
ax[1].axhline(0, color='k', lw=0.5)
ax[1].axvline(0, color='k', lw=0.5)
ax[1].set_xlim(-3, 3)
ax[1].set_ylim(-3, 3)
ax[1].set_aspect('equal')
ax[1].legend(fontsize=8)
ax[1].set_title('Microsoft ML and DataSF shifts (+ = datum shift)')
fig.tight_layout()
fig.savefig(os.path.join(FIG, '5_shift_clusters.png'), dpi=110)
plt.close(fig)
print('ok')
