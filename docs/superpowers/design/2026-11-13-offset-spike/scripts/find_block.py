import os, pickle, sys
import numpy as np, pyproj, shapely
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FP = pickle.load(open(os.path.join(ROOT, 'out', 'footprints.pkl'), 'rb'))
T = pyproj.Transformer.from_crs('EPSG:4326', 'EPSG:7131', always_xy=True)
Ti = pyproj.Transformer.from_crs('EPSG:7131', 'EPSG:4326', always_xy=True)
c = shapely.centroid(shapely.from_wkb(FP['ov_wkb']))
cx, cy = shapely.get_x(c), shapely.get_y(c)
att = FP['ov_iso'] < 0.05
x0, y0 = T.transform(float(sys.argv[1]), float(sys.argv[2]))
hx, hy = float(sys.argv[3]), float(sys.argv[4])
best = []
for x in np.arange(x0 - 600, x0 + 600, 20):
  for y in np.arange(y0 - 600, y0 + 600, 20):
    m = (np.abs(cx - x) < hx) & (np.abs(cy - y) < hy)
    best.append((int((m & att).sum()), int(m.sum()), x, y))
best.sort(reverse=True)
for b in best[:3]:
  print(b[:2], np.round(Ti.transform(b[2], b[3]), 5))
