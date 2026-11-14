import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ept, numpy as np, pyproj
t = pyproj.Transformer.from_crs('EPSG:4326', 'EPSG:7131', always_xy=True)
x, y = t.transform(-122.4805, 37.7608)
t0 = time.time()
bb = (x - 20, y - 20, x + 20, y + 20)
print('nodes', len(ept.nodes_for(ept.T_FROM_7131.transform_bounds(*bb))))
X, Y, Z, C, R, N = ept.points_7131(bb)
print('time', time.time() - t0, 'pts', len(X), 'density/m2', len(X) / 1600)
print('classes', dict(zip(*np.unique(C, return_counts=True))))
print('first-return density', (R == 1).sum() / 1600, 'ground density', (C == 2).sum() / 1600)
