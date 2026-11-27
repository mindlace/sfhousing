"""Extrapolate roofer's runtime and output size to every building with boxes (162,733).

Per-building measurements (t_run, LoD2.2 triangles, glb bytes) from the *_top sets are binned by
footprint area; each bin's mean per m2 is applied to the city's footprint area in that bin.
"""

import json
import os
import sys

import duckdb
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import OVERTURE, ROOFS, SPIKE, WORK  # noqa: E402

BINS = [0, 300, 1500, 1e9]
rows = []
for s in ['detached_top', 'rowhouse_top', 'downtown_top', 'salesforce_top']:
  d = json.load(open(os.path.join(WORK, s, 'compare.json')))
  n = len(d['buildings'])
  for r in d['buildings']:
    if r['t_run_ms'] is None or not r['tri_lod22']:
      continue
    rows.append((r['area_m2'], r['t_run_ms'], r['tri_lod22'], d['glb_roofer'][0] / n,
                 d['glb_roofer'][1] / n, r['tri_ours'] or 0))
a = np.array(rows)

con = duckdb.connect()
con.sql('INSTALL spatial; LOAD spatial;')
area = np.array(
  [
    r[0]
    for r in con.sql(
      f"""select ST_Area(ST_Transform(b.geom, 'EPSG:4326', 'EPSG:7131', always_xy := true))
      from read_parquet('{OVERTURE}') b join read_parquet('{ROOFS}') r on r.bid = b.id"""
    ).fetchall()
  ]
)
out = {'buildings': int(len(area)), 'footprint_m2': float(area.sum()), 'bins': []}
tot = dict(t=0.0, tri=0.0, glb=0.0, glbz=0.0, tri_ours=0.0)
for lo, hi in zip(BINS[:-1], BINS[1:]):
  m = (a[:, 0] >= lo) & (a[:, 0] < hi)
  c = (area >= lo) & (area < hi)
  per_m2 = a[m, 1:].sum(0) / a[m, 0].sum()
  # glb bytes are per-set means; use per-building means scaled by area ratio instead of per m2
  A = area[c].sum()
  t, tri, _, _, tri_o = per_m2 * A
  glb = a[m, 3].mean() / a[m, 0].mean() * A
  glbz = a[m, 4].mean() / a[m, 0].mean() * A
  out['bins'].append(dict(lo=lo, hi=hi, sample=int(m.sum()), city=int(c.sum()), area_m2=float(A),
                          ms_per_m2=float(per_m2[0]), tri_per_m2=float(per_m2[1])))
  tot['t'] += t
  tot['tri'] += tri
  tot['glb'] += glb
  tot['glbz'] += glbz
  tot['tri_ours'] += tri_o
out.update(
  cpu_hours=tot['t'] / 3.6e6,
  wall_minutes_14_threads=tot['t'] / 1000 / 14 / 60,
  triangles_lod22=tot['tri'],
  triangles_ours_measured_bins=tot['tri_ours'],
  glb_mb_raw=tot['glb'] / 1e6,
  glb_mb_gzip=tot['glbz'] / 1e6,
)
print(json.dumps(out, indent=1))
with open(os.path.join(SPIKE, 'cost.json'), 'w') as f:
  json.dump(out, f, indent=1)
