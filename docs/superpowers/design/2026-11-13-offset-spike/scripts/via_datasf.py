"""Predict the OSM offset from footprints alone: DataSF low-rise constant + (DataSF - OSM) centroid shift."""
import os
import pickle

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = pickle.load(open(os.path.join(ROOT, 'out', 'tables.pkl'), 'rb'))
OV, DS = T['OV'], T['DS']
di = {i: k for k, i in enumerate(DS['i'])}
FP = pickle.load(open(os.path.join(ROOT, 'out', 'footprints.pkl'), 'rb'))
C = np.array([1.11, -0.33])
for lab, hmax in [('h<12', 12), ('all h', 1e9)]:
  e = []
  for k in np.where(OV['ok'] & (OV['src'] != 'Microsoft ML Buildings') & (OV['h'] < hmax))[0]:
    i = OV['i'][k]
    if i not in di or FP['ov_ds_iou'][i] < 0.6:
      continue
    j = di[i]
    pred = C + np.array([DS['x'][j] - OV['x'][k], DS['y'][j] - OV['y'][k]])
    e.append(np.hypot(OV['dx'][k] - pred[0], OV['dy'][k] - pred[1]))
  e = np.array(e)
  print(f'{lab}: n={len(e)} median |err| {np.median(e):.2f} rms {np.sqrt(np.mean(e**2)):.2f} '
        f'<=0.3 m {np.mean(e <= 0.3):.2f} <=0.5 m {np.mean(e <= 0.5):.2f}')
