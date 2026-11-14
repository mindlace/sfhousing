"""Fit each sampled building's Overture (and matched DataSF) footprint to the 2023 LiDAR."""

import json
import os
import pickle
import sys
import time
import traceback
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import shapely
from scipy import ndimage

import fitlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'out')
RAS = os.path.join(OUT, 'rasters')
os.makedirs(RAS, exist_ok=True)
with open(os.path.join(OUT, 'footprints.pkl'), 'rb') as f:
  FP = pickle.load(f)


def fit_one(i):
  try:
    ov = shapely.from_wkb(FP['ov_wkb'][i])
    geoms = {'overture': ov}
    j = FP['ov_ds'][i]
    if j >= 0 and FP['ov_ds_iou'][i] > 0.3:
      geoms['datasf'] = shapely.from_wkb(FP['ds_wkb'][j])
    b = np.array(shapely.bounds(shapely.union_all(list(geoms.values()))))
    bbox = (b[0] - 8, b[1] - 8, b[2] + 8, b[3] + 8)
    r = fitlib.hag_raster(bbox)
    if r is None:
      return dict(i=int(i), error='no points')
    m0 = fitlib.mask_of(ov, r)
    inner = ndimage.binary_erosion(m0, iterations=2)
    hv = r['hag'][inner if inner.sum() > 10 else m0]
    href = float(np.median(hv))
    hn, gx, gy = fitlib.prepare(r, href)
    res = dict(i=int(i), id=str(FP['ov_id'][i]), src=str(FP['ov_src'][i]), npts=int(r['npts']))
    for name, g in geoms.items():
      shifts, S = fitlib.score_grid(r, gx, gy, g)
      pk = fitlib.analyse_peak(shifts, S)
      pk['iou0'] = fitlib.iou_at(g, r, 0, 0)
      pk['iou'] = fitlib.iou_at(g, r, pk['dx'], pk['dy'])
      m = fitlib.mask_of(g, r, pk['dx'], pk['dy'])
      inner = ndimage.binary_erosion(m, iterations=2)
      hv = r['hag'][inner if inner.sum() > 10 else m]
      pk['h_med'] = float(np.median(hv))
      pk['h_p90'] = float(np.percentile(hv, 90))
      pk['area'] = float(g.area)
      c = g.centroid
      pk['cx'], pk['cy'] = c.x, c.y
      res[name] = pk
      if name == 'overture':
        np.savez_compressed(
          os.path.join(RAS, f'{i}.npz'), hag=r['hag'].astype(np.float32), veg=r['veg'],
          x0=r['x0'], y0=r['y0'], S=S.astype(np.float32), shifts=shifts
        )
    return res
  except Exception as e:
    return dict(i=int(i), error=repr(e), tb=traceback.format_exc())


if __name__ == '__main__':
  sample = FP['sample']
  if len(sys.argv) > 1:
    sample = sample[: int(sys.argv[1])]
  out_path = os.path.join(OUT, 'fits.ndjson')
  done = set()
  if os.path.exists(out_path):
    with open(out_path) as f:
      done = {json.loads(l)['i'] for l in f}
  todo = [i for i in sample if int(i) not in done]
  print('todo', len(todo), flush=True)
  t0 = time.time()
  with Pool(10) as pool, open(out_path, 'a') as f:
    for n, res in enumerate(pool.imap_unordered(fit_one, todo)):
      f.write(json.dumps(res) + '\n')
      f.flush()
      if 'error' in res:
        print('ERR', res['i'], res['error'], flush=True)
      if n % 25 == 0:
        print(n, f'{time.time() - t0:.0f}s', flush=True)
  print('done', time.time() - t0)
