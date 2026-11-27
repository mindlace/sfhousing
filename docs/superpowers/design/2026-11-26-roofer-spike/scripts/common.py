"""Shared paths and the EPT reader for the roofer spike.

The EPT reader is the offset spike's (`2026-11-13-offset-spike/scripts/ept.py`), pointed at the
pipeline's node cache read-only: a node missing from that cache is downloaded into the spike's own
work dir instead. Points come back in EPSG:7131 metres; Z is the EPT's (NAVD88 metres).
"""

import json
import os
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import laspy
import numpy as np
import pyproj

HERE = os.path.dirname(os.path.abspath(__file__))
SPIKE = os.path.dirname(HERE)
CACHE = os.environ.get(
  'SFH_CACHE',
  '/Users/mindlace/Projects/sfhousing/.claude/worktrees/building-steps/pipeline/.cache'
)
WORK = os.environ.get(
  'SPIKE_WORK',
  '/private/tmp/claude-501/-Users-mindlace-Projects-sfhousing/'
  '4a870fac-1a89-4e85-ac67-87da80271fe0/scratchpad/work'
)
ROOFER = os.environ.get(
  'ROOFER',
  '/private/tmp/claude-501/-Users-mindlace-Projects-sfhousing/'
  '4a870fac-1a89-4e85-ac67-87da80271fe0/scratchpad/roofer-dl/bin/roofer'
)
OVERTURE = os.path.join(CACHE, 'raw', '0a8bca61efe49e2f3159606b7de6da114b2ca28ad5b06cd9d3bc5253de6e1a75')
BOXES = os.environ.get('SFH_BOXES') or os.path.join(CACHE, 'raw', '849943fe26ec09d91c7c4d5b0a9266a96672ac3c2aafc3c4381bdd3d852d713c')
ROOFS = os.environ.get('SFH_ROOFS') or os.path.join(CACHE, 'raw', 'c12d536ed6562e85066422108c05de15fde83b144bc2c0bd643bf62dd0c13d1d')
os.makedirs(WORK, exist_ok=True)

BASE = 'https://s3-us-west-2.amazonaws.com/usgs-lidar-public/CA_SanFrancisco_1_B23'
EPT_RO = os.path.join(CACHE, 'ept')
EPT_RW = os.path.join(WORK, 'ept')
os.makedirs(os.path.join(EPT_RW, 'h'), exist_ok=True)
os.makedirs(os.path.join(EPT_RW, 'n'), exist_ok=True)

T_TO_7131 = pyproj.Transformer.from_crs('EPSG:3857', 'EPSG:7131', always_xy=True)
T_FROM_7131 = pyproj.Transformer.from_crs('EPSG:7131', 'EPSG:3857', always_xy=True)
T_LL_7131 = pyproj.Transformer.from_crs('EPSG:4326', 'EPSG:7131', always_xy=True)
_lock = threading.Lock()


def _get(rel, url):
  ro = os.path.join(EPT_RO, rel)
  if os.path.exists(ro):
    return ro
  path = os.path.join(EPT_RW, rel)
  if not os.path.exists(path):
    tmp = path + '.part.' + str(threading.get_ident())
    with urllib.request.urlopen(url, timeout=120) as r, open(tmp, 'wb') as f:
      f.write(r.read())
    os.replace(tmp, path)
  return path


with open(_get('ept.json', BASE + '/ept.json')) as f:
  META = json.load(f)
B = META['bounds']
SIZE = B[3] - B[0]
HIER = {}
_loaded = set()


def _load_hier(key):
  with _lock:
    if key in _loaded:
      return
  with open(_get(f'h/{key}.json', f'{BASE}/ept-hierarchy/{key}.json')) as f:
    h = json.load(f)
  with _lock:
    HIER.update(h)
    _loaded.add(key)


_load_hier('0-0-0-0')


def node_bounds(key):
  d, x, y, _ = map(int, key.split('-'))
  s = SIZE / (1 << d)
  return B[0] + x * s, B[1] + y * s, B[0] + (x + 1) * s, B[1] + (y + 1) * s


def nodes_for(bbox):
  out, stack = [], ['0-0-0-0']
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


_pool = ThreadPoolExecutor(8)


def _node(key):
  return _get(f'n/{key}.laz', f'{BASE}/ept-data/{key}.laz')


def points_7131(bbox):
  """dict of arrays (x, y, z, cls, ret, nret, intensity) for points inside bbox (EPSG:7131)."""
  xs, ys = T_FROM_7131.transform(
    [bbox[0], bbox[2], bbox[0], bbox[2]], [bbox[1], bbox[1], bbox[3], bbox[3]]
  )
  bb = (min(xs) - 1, min(ys) - 1, max(xs) + 1, max(ys) + 1)
  keys = nodes_for(bb)
  paths = list(_pool.map(_node, keys))
  parts = []
  for p in paths:
    las = laspy.read(p)
    x, y = np.asarray(las.x), np.asarray(las.y)
    m = (x >= bb[0]) & (x <= bb[2]) & (y >= bb[1]) & (y <= bb[3])
    if m.any():
      parts.append(
        (
          x[m],
          y[m],
          np.asarray(las.z)[m],
          np.asarray(las.classification)[m],
          np.asarray(las.return_number)[m],
          np.asarray(las.number_of_returns)[m],
          np.asarray(las.intensity)[m],
        )
      )
  x, y, z, c, r, n, i = (np.concatenate(a) for a in zip(*parts))
  X, Y = T_TO_7131.transform(x, y)
  m = (X >= bbox[0]) & (X <= bbox[2]) & (Y >= bbox[1]) & (Y <= bbox[3])
  return dict(x=X[m], y=Y[m], z=z[m], cls=c[m], ret=r[m], nret=n[m], intensity=i[m])


def write_laz(path, pts):
  h = laspy.LasHeader(point_format=6, version='1.4')
  h.scales = np.array([0.01, 0.01, 0.01])
  h.offsets = np.array([np.floor(pts['x'].min()), np.floor(pts['y'].min()), 0.0])
  h.add_crs(pyproj.CRS.from_epsg(7131))
  las = laspy.LasData(h)
  las.x, las.y, las.z = pts['x'], pts['y'], pts['z']
  las.classification = pts['cls']
  las.return_number = np.clip(pts['ret'], 1, 15)
  las.number_of_returns = np.clip(pts['nret'], 1, 15)
  las.intensity = pts['intensity']
  las.write(path)
