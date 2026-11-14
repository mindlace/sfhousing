"""Minimal Entwine Point Tile reader (EPSG:3857, laszip nodes), ported from the offset spike.

Metadata, hierarchy files and nodes are cached under `cache`: `ept.json`, `h/<key>.json` and
`n/<key>.laz`. Downloads go to a temporary name first, so an interrupted run never leaves a
partial file under its final name.
"""

import json
import os
import threading
import urllib.request

_RETRIES = 4


def _get(url, path):
  if os.path.exists(path):
    return path
  os.makedirs(os.path.dirname(path), exist_ok=True)
  tmp = f'{path}.part.{os.getpid()}.{threading.get_ident()}'
  for attempt in range(_RETRIES):
    try:
      with urllib.request.urlopen(url, timeout=120) as r, open(tmp, 'wb') as f:
        f.write(r.read())
      os.replace(tmp, path)
      return path
    except Exception:
      if os.path.exists(tmp):
        os.remove(tmp)
      if attempt == _RETRIES - 1:
        raise
  return path


class Ept:
  """One EPT dataset: `url` is its ept.json."""

  def __init__(self, url, cache):
    self.base = url.rsplit('/', 1)[0]
    self.cache = cache
    with open(_get(url, os.path.join(cache, 'ept.json'))) as f:
      self.meta = json.load(f)
    if self.meta.get('dataType') != 'laszip':
      raise ValueError(f'ept: unsupported dataType {self.meta.get("dataType")}')
    srs = self.meta.get('srs', {})
    if srs.get('horizontal') != '3857':
      raise ValueError(f'ept: expected EPSG:3857, got {srs.get("horizontal")}')
    b = self.meta['bounds']
    self.bounds = b
    self.size = b[3] - b[0]
    self.hier = {}
    self._loaded = set()
    self._load_hier('0-0-0-0')

  def _load_hier(self, key):
    if key in self._loaded:
      return
    p = _get(f'{self.base}/ept-hierarchy/{key}.json', os.path.join(self.cache, 'h', key + '.json'))
    with open(p) as f:
      self.hier.update(json.load(f))
    self._loaded.add(key)

  def node_bounds(self, key):
    d, x, y, _ = map(int, key.split('-'))
    s = self.size / (1 << d)
    b = self.bounds
    return b[0] + x * s, b[1] + y * s, b[0] + (x + 1) * s, b[1] + (y + 1) * s

  def nodes_for(self, bbox):
    """[(key, points)] of the nodes with points intersecting bbox (minx, miny, maxx, maxy; 3857)."""
    out = []
    stack = ['0-0-0-0']
    while stack:
      k = stack.pop()
      if k not in self.hier:
        continue
      if self.hier[k] == -1:
        self._load_hier(k)
      x0, y0, x1, y1 = self.node_bounds(k)
      if x1 < bbox[0] or x0 > bbox[2] or y1 < bbox[1] or y0 > bbox[3]:
        continue
      if self.hier[k] > 0:
        out.append((k, self.hier[k]))
      d, x, y, z = map(int, k.split('-'))
      for dx in (0, 1):
        for dy in (0, 1):
          for dz in (0, 1):
            c = f'{d + 1}-{2 * x + dx}-{2 * y + dy}-{2 * z + dz}'
            if c in self.hier:
              stack.append(c)
    return sorted(out)

  def node_path(self, key):
    return _get(f'{self.base}/ept-data/{key}.laz', os.path.join(self.cache, 'n', key + '.laz'))
