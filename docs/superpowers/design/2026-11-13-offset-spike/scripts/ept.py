"""Minimal EPT reader for the USGS CA_SanFrancisco_1_B23 point cloud (EPSG:3857, laszip nodes).

Nodes and hierarchy files are cached under data/ept/. Points come back in EPSG:7131 metres
(NAD83(2011) / San Francisco CS13), the source CRS, via the inverse of the PROJ operation the USGS
used (it includes 'NAD83(2011) to WGS 84 (1)', a null datum shift, so this is exact).
"""

import json
import os
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import laspy
import numpy as np
import pyproj

BASE = 'https://s3-us-west-2.amazonaws.com/usgs-lidar-public/CA_SanFrancisco_1_B23'
DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'ept')
os.makedirs(os.path.join(DATA, 'h'), exist_ok=True)
os.makedirs(os.path.join(DATA, 'n'), exist_ok=True)

T_TO_7131 = pyproj.Transformer.from_crs('EPSG:3857', 'EPSG:7131', always_xy=True)
T_FROM_7131 = pyproj.Transformer.from_crs('EPSG:7131', 'EPSG:3857', always_xy=True)

_lock = threading.Lock()


def _get(url, path):
  if not os.path.exists(path):
    tmp = path + '.part.' + str(os.getpid()) + '.' + str(threading.get_ident())
    for attempt in range(4):
      try:
        with urllib.request.urlopen(url, timeout=120) as r, open(tmp, 'wb') as f:
          f.write(r.read())
        os.replace(tmp, path)
        break
      except Exception:
        if attempt == 3:
          raise
  return path


with open(_get(BASE + '/ept.json', os.path.join(DATA, 'ept.json'))) as f:
  META = json.load(f)
B = META['bounds']
SIZE = B[3] - B[0]
HIER = {}
_loaded = set()


def _load_hier(key):
  with _lock:
    if key in _loaded:
      return
  p = _get(f'{BASE}/ept-hierarchy/{key}.json', os.path.join(DATA, 'h', key + '.json'))
  with open(p) as f:
    h = json.load(f)
  with _lock:
    HIER.update(h)
    _loaded.add(key)


_load_hier('0-0-0-0')


def node_bounds(key):
  d, x, y, z = map(int, key.split('-'))
  s = SIZE / (1 << d)
  return B[0] + x * s, B[1] + y * s, B[0] + (x + 1) * s, B[1] + (y + 1) * s


def nodes_for(bbox):
  """Keys of nodes with points intersecting bbox (minx, miny, maxx, maxy in 3857)."""
  out = []
  stack = ['0-0-0-0']
  while stack:
    k = stack.pop()
    if k not in HIER:
      continue
    if HIER[k] == -1:
      _load_hier(k)
    x0, y0, x1, y1 = node_bounds(k)
    if x1 < bbox[0] or x0 > bbox[2] or y1 < bbox[1] or y0 > bbox[3]:
      continue
    if HIER[k] > 0:
      out.append(k)
    d, x, y, z = map(int, k.split('-'))
    for dx in (0, 1):
      for dy in (0, 1):
        for dz in (0, 1):
          c = f'{d + 1}-{2 * x + dx}-{2 * y + dy}-{2 * z + dz}'
          if c in HIER:
            stack.append(c)
  return out


def fetch_node(key):
  return _get(f'{BASE}/ept-data/{key}.laz', os.path.join(DATA, 'n', key + '.laz'))


_pool = ThreadPoolExecutor(16)


def points_7131(bbox7131):
  """x, y, z, cls, ret, nret for points within bbox7131 (EPSG:7131 metres)."""
  xs, ys = T_FROM_7131.transform(
    [bbox7131[0], bbox7131[2], bbox7131[0], bbox7131[2]],
    [bbox7131[1], bbox7131[1], bbox7131[3], bbox7131[3]]
  )
  bb = (min(xs) - 1, min(ys) - 1, max(xs) + 1, max(ys) + 1)
  keys = nodes_for(bb)
  paths = list(_pool.map(fetch_node, keys))
  parts = []
  for p in paths:
    las = laspy.read(p)
    x = np.asarray(las.x)
    y = np.asarray(las.y)
    m = (x >= bb[0]) & (x <= bb[2]) & (y >= bb[1]) & (y <= bb[3])
    if not m.any():
      continue
    parts.append(
      (
        x[m],
        y[m],
        np.asarray(las.z)[m],
        np.asarray(las.classification)[m],
        np.asarray(las.return_number)[m],
        np.asarray(las.number_of_returns)[m],
      )
    )
  if not parts:
    return None
  x, y, z, c, r, n = (np.concatenate(a) for a in zip(*parts))
  X, Y = T_TO_7131.transform(x, y)
  m = (X >= bbox7131[0]) & (X <= bbox7131[2]) & (Y >= bbox7131[1]) & (Y <= bbox7131[3])
  return X[m], Y[m], z[m], c[m], r[m], n[m]
