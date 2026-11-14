"""Two-frame (lineage) model for OSM offsets, and a relief test inside each frame / for DataSF."""

import os
import pickle

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out')
T = pickle.load(open(os.path.join(OUT, 'tables.pkl'), 'rb'))
OV, DS, X0, Y0 = T['OV'], T['DS'], T['X0'], T['Y0']


def sub(t, m):
  return {k: v[m] for k, v in t.items()}


ovk = sub(OV, OV['ok'])
osm = sub(ovk, ovk['src'] != 'Microsoft ML Buildings')
D = np.column_stack([osm['dx'], osm['dy']])

# robust 2-means
C = np.array([[0.0, 0.3], [1.3, -0.35]])
for _ in range(30):
  d = np.linalg.norm(D[:, None, :] - C[None], axis=2)
  lab = d.argmin(1)
  near = d.min(1) < 0.8
  C = np.array([np.median(D[(lab == k) & near], axis=0) for k in range(2)])
d = np.linalg.norm(D[:, None, :] - C[None], axis=2)
lab = d.argmin(1)
e = d.min(1)
print('OSM frame centres (shift onto LiDAR):', C.round(2).tolist())
for k in range(2):
  m = lab == k
  print(f'  frame {k}: n={m.sum()} share={m.mean():.2f} rms to centre {np.sqrt(np.mean(e[m]**2)):.2f} '
        f'median {np.median(e[m]):.2f} <=0.3 m {np.mean(e[m] <= 0.3):.2f} <=0.5 m {np.mean(e[m] <= 0.5):.2f}')
print(f'  oracle two-frame (frame known): rms {np.sqrt(np.mean(e**2)):.2f}, median {np.median(e):.2f}, '
      f'<=0.3 m {np.mean(e <= 0.3):.2f}, <=0.5 m {np.mean(e <= 0.5):.2f}')
h = osm['h']
for k in range(2):
  m = (lab == k) & (e < 1.0)
  for comp, j in [('dx', 0), ('dy', 1)]:
    r = D[m, j] - C[k, j]
    A = np.column_stack([np.ones(m.sum()), h[m]])
    b, *_ = np.linalg.lstsq(A, r, rcond=None)
    print(f'  frame {k} {comp} residual vs h: slope {b[1] * 100:+.2f} cm per 100 m... per metre {b[1]:+.4f}')
print('  frame-residual magnitude by height:')
for lo, hi in [(0, 10), (10, 20), (20, 50), (50, 500)]:
  m = (h >= lo) & (h < hi)
  print(f'    h {lo}-{hi}: n={m.sum()} median |e| {np.median(e[m]):.2f} share frame1 {np.mean(lab[m] == 1):.2f}')

# spatial coherence of frame label: nearest neighbour agreement
xy = np.column_stack([osm['x'], osm['y']])
dd = np.linalg.norm(xy[:, None] - xy[None], axis=2)
np.fill_diagonal(dd, np.inf)
nn = dd.argmin(1)
for lim in [300, 600, 1500]:
  m = dd.min(1) < lim
  print(f'  nearest neighbour within {lim} m: n={m.sum()} same frame {np.mean(lab[m] == lab[nn][m]):.2f} '
        f'(chance {np.mean(lab == 0)**2 + np.mean(lab == 1)**2:.2f})')

# DataSF: excess of tall buildings over the local low-rise offset
ds = sub(DS, DS['ok'])
low = ds['h'] < 12
print('\nDataSF low-rise (<12 m) offset median', np.median(ds['dx'][low]).round(2), np.median(ds['dy'][low]).round(2),
      'IQR', np.subtract(*np.percentile(ds['dx'][low], [75, 25])).round(2),
      np.subtract(*np.percentile(ds['dy'][low], [75, 25])).round(2))
rows = []
for k in np.where(ds['h'] >= 15)[0]:
  dist = np.hypot(ds['x'][low] - ds['x'][k], ds['y'][low] - ds['y'][k])
  o = np.argsort(dist)[:5]
  o = o[dist[o] < 1200]
  if len(o) < 3:
    continue
  bx, by = np.median(ds['dx'][low][o]), np.median(ds['dy'][low][o])
  rows.append((ds['h'][k], ds['dx'][k] - bx, ds['dy'][k] - by, ds['x'][k], ds['y'][k]))
R = np.array(rows)
print(f'DataSF h>=15 with local low-rise base: n={len(R)}')
for lo, hi in [(15, 25), (25, 40), (40, 80), (80, 500)]:
  m = (R[:, 0] >= lo) & (R[:, 0] < hi)
  if m.sum():
    mag = np.hypot(R[m, 1], R[m, 2])
    print(f'  h {lo}-{hi}: n={m.sum()} excess median ({np.median(R[m, 1]):+.2f},{np.median(R[m, 2]):+.2f}) '
          f'|excess| median {np.median(mag):.2f}  |excess|/h median {np.median(mag / R[m, 0]):.4f}')
low_l = ds['h'] < 12
rr = []
for k in np.where(low_l)[0]:
  dist = np.hypot(ds['x'][low_l] - ds['x'][k], ds['y'][low_l] - ds['y'][k])
  dist[dist < 1e-3] = np.inf
  o = np.argsort(dist)[:5]
  o = o[dist[o] < 1200]
  if len(o) >= 3:
    rr.append(np.hypot(ds['dx'][k] - np.median(ds['dx'][low_l][o]), ds['dy'][k] - np.median(ds['dy'][low_l][o])))
rr = np.array(rr)
print(f'  low-rise vs its own neighbours (control): n={len(rr)} median |e| {np.median(rr):.2f} <=0.3 m {np.mean(rr <= 0.3):.2f}')
np.save(os.path.join(OUT, 'osm_frames.npy'), np.column_stack([osm['i'], lab, e]))
pickle.dump(dict(C=C), open(os.path.join(OUT, 'osm_frames.pkl'), 'wb'))
