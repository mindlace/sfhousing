"""Make a '<set>_top' copy of a test set whose class-1 points keep only the top surface.

roofer assumes a 2.5D roof: every class-1 point inside the footprint is a roof sample. On towers the
oblique scan puts facade points at every height inside the footprint, and roofer fits planes to
them (spiky crowns). This keeps a class-1 point only when it lies within DROP m of the highest
class-1 point of its CELL x CELL cell; ground (class 2) is untouched.
Usage: topfilter.py <set> [<set> ...]
"""

import glob
import os
import shutil
import sys

import laspy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import WORK  # noqa: E402

CELL, DROP = 1.0, 1.5

for name in sys.argv[1:]:
  src, dst = os.path.join(WORK, name), os.path.join(WORK, name + '_top')
  os.makedirs(os.path.join(dst, 'pc'), exist_ok=True)
  shutil.copy(os.path.join(src, 'footprints.gpkg'), os.path.join(dst, 'footprints.gpkg'))
  for p in sorted(glob.glob(os.path.join(src, 'pc', '*.laz'))):
    las = laspy.read(p)
    x, y, z, c = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z), np.asarray(las.classification)
    b = c == 1
    ij = np.floor(np.column_stack([x, y]) / CELL).astype(np.int64)
    key = ij[:, 0] * 10_000_000 + ij[:, 1]
    u, inv = np.unique(key[b], return_inverse=True)
    top = np.full(len(u), -np.inf)
    np.maximum.at(top, inv, z[b])
    keep = ~b
    kb = z[b] >= top[inv] - DROP
    keep[np.where(b)[0][kb]] = True
    out = laspy.LasData(las.header)
    out.points = las.points[keep]
    out.write(os.path.join(dst, 'pc', os.path.basename(p)))
    print(name, os.path.basename(p), 'class1 kept', int(kb.sum()), 'of', int(b.sum()))
