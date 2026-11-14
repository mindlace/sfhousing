"""Offset statistics, model fits (cross-validated) and figures."""

import json
import os
import pickle
import sys

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import shapely

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out')
FIG = os.path.join(OUT, 'fig')
os.makedirs(FIG, exist_ok=True)
rows = [json.loads(l) for l in open(os.path.join(OUT, 'fits.ndjson'))]
rows = [r for r in rows if 'error' not in r]


def accept(p):
  return (
    not p['at_edge'] and p['second'] / p['score'] < 0.85 and p['sx'] < 0.35 and p['sy'] < 0.35
    and p['iou'] > 0.5 and p['score'] > 0.25
  )


def table(key):
  T = []
  for r in rows:
    if key not in r:
      continue
    p = r[key]
    T.append(
      dict(i=r['i'], src=r['src'], ok=accept(p), dx=p['dx'], dy=p['dy'], h=p['h_med'],
           h90=p['h_p90'], x=p['cx'], y=p['cy'], area=p['area'], iou=p['iou'], iou0=p['iou0'])
    )
  return {k: np.array([t[k] for t in T]) for k in T[0]}


OV = table('overture')
DS = table('datasf')
print('overture fitted', len(OV['i']), 'accepted', OV['ok'].sum())
print('datasf fitted', len(DS['i']), 'accepted', DS['ok'].sum())
X0, Y0 = np.median(OV['x']), np.median(OV['y'])


# ---------------------------------------------------------------- models
def design(t, model, km=None):
  n = len(t['h'])
  h = t['h']
  px, py = (t['x'] - X0) / 1000, (t['y'] - Y0) / 1000  # km
  one = np.ones(n)
  if model == 'const':
    return [one], [one]
  if model == 'lin_h':  # a + b*h, b a constant look vector
    return [one, h], [one, h]
  if model == 'nadir1':  # a + h*(c - p)/H; shared k = 1/H
    return None
  if model == 'grad':  # const + linear position trend (smooth datum/warp)
    return [one, px, py], [one, px, py]
  if model == 'grad_h':
    return [one, px, py, h], [one, px, py, h]
  raise ValueError(model)


def fit_predict(train, test, model):
  if model == 'nadir1':
    # unknowns: ax, ay, ux, uy, k ; dx = ax + h*ux - k*h*px ; dy = ay + h*uy - k*h*py
    def A(t):
      n = len(t['h'])
      h = t['h']
      px, py = (t['x'] - X0) / 1000, (t['y'] - Y0) / 1000
      z = np.zeros(n)
      o = np.ones(n)
      top = np.column_stack([o, z, h, z, -h * px])
      bot = np.column_stack([z, o, z, h, -h * py])
      return np.vstack([top, bot])

    coef, *_ = np.linalg.lstsq(A(train), np.concatenate([train['dx'], train['dy']]), rcond=None)
    pr = A(test) @ coef
    n = len(test['h'])
    return pr[:n], pr[n:], coef
  if model == 'knn':  # median of the k nearest training neighbours (within 600 m)
    px, py = [], []
    for x, y in zip(test['x'], test['y']):
      d = np.hypot(train['x'] - x, train['y'] - y)
      d = np.where(d < 1e-3, np.inf, d)
      o = np.argsort(d)[:6]
      o = o[d[o] < 600]
      if len(o) == 0:
        px.append(np.median(train['dx']))
        py.append(np.median(train['dy']))
      else:
        px.append(np.median(train['dx'][o]))
        py.append(np.median(train['dy'][o]))
    return np.array(px), np.array(py), None
  if model == 'knn_h':  # lin_h then kNN on residuals
    fx, fy, c = fit_predict(train, train, 'lin_h')
    rt = dict(train)
    rt['dx'] = train['dx'] - fx
    rt['dy'] = train['dy'] - fy
    kx, ky, _ = fit_predict(rt, test, 'knn')
    lx, ly, _ = fit_predict(train, test, 'lin_h')
    return lx + kx, ly + ky, None
  cx, cy = design(train, model)
  Ax = np.column_stack(cx)
  Ay = np.column_stack(cy)
  bx, *_ = np.linalg.lstsq(Ax, train['dx'], rcond=None)
  by, *_ = np.linalg.lstsq(Ay, train['dy'], rcond=None)
  tx, ty = design(test, model)
  return np.column_stack(tx) @ bx, np.column_stack(ty) @ by, (bx, by)


def sub(t, m):
  return {k: v[m] for k, v in t.items()}


def cv(t, model, folds=10, seed=0):
  n = len(t['h'])
  rng = np.random.default_rng(seed)
  f = rng.permutation(n) % folds
  ex, ey = np.zeros(n), np.zeros(n)
  for k in range(folds):
    tr, te = f != k, f == k
    px, py, _ = fit_predict(sub(t, tr), sub(t, te), model)
    ex[te] = t['dx'][te] - px
    ey[te] = t['dy'][te] - py
  return ex, ey


MODELS = ['const', 'lin_h', 'nadir1', 'grad', 'grad_h', 'knn', 'knn_h']
report = {}


def rms(ex, ey):
  return float(np.sqrt(np.mean(ex**2 + ey**2)))


def evaluate(name, t):
  print(f'\n== {name}: n={len(t["h"])}')
  out = {}
  for m in MODELS:
    ex, ey = cv(t, m)
    _, _, coef = fit_predict(t, t, m)
    out[m] = dict(
      rms=rms(ex, ey), rmsx=float(np.sqrt(np.mean(ex**2))), rmsy=float(np.sqrt(np.mean(ey**2))),
      mad=float(np.median(np.hypot(ex, ey))), within03=float(np.mean(np.hypot(ex, ey) <= 0.3)),
      coef=None if coef is None else [np.asarray(c).round(4).tolist() for c in coef]
    )
    print(f'{m:8s} cv-rms {out[m]["rms"]:.2f} (x {out[m]["rmsx"]:.2f} y {out[m]["rmsy"]:.2f}) '
          f'median|e| {out[m]["mad"]:.2f} share<=0.3m {out[m]["within03"]:.2f} coef {out[m]["coef"]}')
  return out


ovk = sub(OV, OV['ok'])
report['overture_all'] = evaluate('Overture accepted', ovk)
osm = sub(ovk, np.char.startswith(ovk['src'].astype(str), 'OpenStreetMap'))
ml = sub(ovk, ovk['src'] == 'Microsoft ML Buildings')
report['overture_osm'] = evaluate('Overture OSM-geometry', osm)
if len(ml['h']) > 8:
  report['overture_ml'] = evaluate('Overture Microsoft-geometry', ml)
dsk = sub(DS, DS['ok'])
report['datasf'] = evaluate('DataSF accepted', dsk)

# regions: split city into quadrants around the median
for name, t in [('overture', ovk), ('datasf', dsk)]:
  print(f'\n{name} by region (const / lin_h cv-rms computed on whole set, reported per region)')
  ex0, ey0 = cv(t, 'const')
  ex1, ey1 = cv(t, 'lin_h')
  exk, eyk = cv(t, 'knn_h')
  reg = np.where(t['x'] > X0, 'E', 'W').astype(object) + np.where(t['y'] > Y0, 'N', 'S')
  for rname in sorted(set(reg)):
    m = reg == rname
    print(f'  {rname} n={m.sum()} med d=({np.median(t["dx"][m]):+.2f},{np.median(t["dy"][m]):+.2f}) '
          f'const {rms(ex0[m], ey0[m]):.2f} lin_h {rms(ex1[m], ey1[m]):.2f} knn_h {rms(exk[m], eyk[m]):.2f}')

# height bins
for name, t in [('overture', ovk), ('osm', osm), ('ml', ml), ('datasf', dsk)]:
  print(f'\n{name} by height')
  for lo, hi in [(0, 6), (6, 10), (10, 20), (20, 50), (50, 500)]:
    m = (t['h'] >= lo) & (t['h'] < hi)
    if m.sum() < 3:
      continue
    print(f'  h {lo:3d}-{hi:3d} n={m.sum():3d} median d=({np.median(t["dx"][m]):+.2f},{np.median(t["dy"][m]):+.2f}) '
          f'spread (IQR) dx {np.subtract(*np.percentile(t["dx"][m], [75, 25])):.2f} dy {np.subtract(*np.percentile(t["dy"][m], [75, 25])):.2f}')

# paired: same building, overture vs datasf
pair = np.intersect1d(OV['i'][OV['ok']], DS['i'][DS['ok']])
oi = {i: k for k, i in enumerate(OV['i'])}
di = {i: k for k, i in enumerate(DS['i'])}
a = np.array([oi[i] for i in pair])
b = np.array([di[i] for i in pair])
ddx = OV['dx'][a] - DS['dx'][b]
ddy = OV['dy'][a] - DS['dy'][b]
print(f'\npaired overture-datasf n={len(pair)} median diff (ov - ds) = ({np.median(ddx):+.2f},{np.median(ddy):+.2f}) '
      f'IQR ({np.subtract(*np.percentile(ddx, [75, 25])):.2f},{np.subtract(*np.percentile(ddy, [75, 25])):.2f})')
for s in ['OpenStreetMap', 'Microsoft ML Buildings']:
  m = np.array([str(OV['src'][k]).startswith(s) for k in a])
  if m.sum():
    print(f'   {s}: n={m.sum()} median diff ({np.median(ddx[m]):+.2f},{np.median(ddy[m]):+.2f}) '
          f'share |diff|<0.3 m {np.mean(np.hypot(ddx[m], ddy[m]) < 0.3):.2f}')

with open(os.path.join(OUT, 'models.json'), 'w') as f:
  json.dump(report, f, indent=1)
with open(os.path.join(OUT, 'tables.pkl'), 'wb') as f:
  pickle.dump(dict(OV=OV, DS=DS, X0=X0, Y0=Y0), f)
