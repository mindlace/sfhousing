"""Load Overture + DataSF footprints into EPSG:7131, find detached buildings, draw the sample."""

import glob
import json
import os
import pickle
import sys

import duckdb
import numpy as np
import pyproj
import shapely
from shapely import STRtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OVERTURE = sys.argv[1]
OUT = os.path.join(ROOT, 'out')
os.makedirs(OUT, exist_ok=True)
T = pyproj.Transformer.from_crs('EPSG:4326', 'EPSG:7131', always_xy=True)


def proj(geoms):
  return shapely.transform(geoms, lambda xy: np.column_stack(T.transform(xy[:, 0], xy[:, 1])))


con = duckdb.connect()
con.sql('INSTALL spatial; LOAD spatial;')
rows = con.sql(
  f"select id, height, datasets, ST_AsWKB(geom) from read_parquet('{OVERTURE}')"
).fetchall()
ov_id = np.array([r[0] for r in rows])
ov_h = np.array([np.nan if r[1] is None else r[1] for r in rows])
ov_src = np.array(['+'.join(r[2]) for r in rows])
ov_geom = proj(shapely.from_wkb([bytes(r[3]) for r in rows]))
print('overture', len(ov_id))

ds = []
for p in sorted(glob.glob(os.path.join(ROOT, 'data', 'datasf_*.json'))):
  with open(p) as f:
    ds.extend(json.load(f))
ds_id = np.array([d['sf16_bldgid'] for d in ds])
ds_h = np.array([float(d.get('hgt_median_m') or 'nan') for d in ds])
ds_geom = proj(np.array([shapely.geometry.shape(d['shape']) for d in ds]))
ds_geom = shapely.make_valid(ds_geom)
ov_geom = shapely.make_valid(ov_geom)
print('datasf', len(ds_id))


def isolation(geoms):
  tree = STRtree(geoms)
  # nearest other footprint distance
  idx, dist = tree.query_nearest(geoms, return_distance=True, exclusive=True, all_matches=False)
  d = np.full(len(geoms), np.inf)
  d[idx[0]] = dist
  return d


ov_iso = isolation(ov_geom)
ds_iso = isolation(ds_geom)

# match Overture -> DataSF by IoU
tree = STRtree(ds_geom)
pairs = tree.query(ov_geom, predicate='intersects')
inter = shapely.area(shapely.intersection(ov_geom[pairs[0]], ds_geom[pairs[1]]))
union = shapely.area(ov_geom[pairs[0]]) + shapely.area(ds_geom[pairs[1]]) - inter
iou = inter / union
best = {}
for a, b, v in zip(pairs[0], pairs[1], iou):
  if v > best.get(a, (None, 0))[1]:
    best[a] = (b, v)
ov_ds = np.full(len(ov_id), -1)
ov_ds_iou = np.zeros(len(ov_id))
for a, (b, v) in best.items():
  ov_ds[a] = b
  ov_ds_iou[a] = v

area = shapely.area(ov_geom)
hgt = np.where(ov_ds >= 0, ds_h[np.maximum(ov_ds, 0)], np.nan)
hgt = np.where(np.isnan(hgt), ov_h, hgt)
cent = shapely.centroid(ov_geom)
cx, cy = shapely.get_x(cent), shapely.get_y(cent)

ok = (ov_iso >= 1.5) & (area >= 40) & (area <= 20000) & np.isfinite(hgt) & (hgt >= 2.5)
print('detached candidates', ok.sum())
rng = np.random.default_rng(7)
cell = np.floor(cx / 1500).astype(int) * 1000 + np.floor(cy / 1500).astype(int)
bins = [(2.5, 8), (8, 20), (20, 50), (50, 400)]
quota = [110, 120, 110, 80]
chosen = set()
for (lo, hi), q in zip(bins, quota):
  cand = np.where(ok & (hgt >= lo) & (hgt < hi))[0]
  rng.shuffle(cand)
  by_cell = {}
  for i in cand:
    by_cell.setdefault(cell[i], []).append(i)
  picked = 0
  while picked < q and any(by_cell.values()):
    for k in list(by_cell):
      if by_cell[k] and picked < q:
        chosen.add(by_cell[k].pop())
        picked += 1
  print(f'height {lo}-{hi}: candidates {len(cand)} picked {picked}')
ml = np.where(ok & (ov_src == 'Microsoft ML Buildings'))[0]
rng.shuffle(ml)
print('detached ML-only candidates', len(ml))
for i in ml[:50]:
  chosen.add(i)
osmml = np.where(ok & (ov_src == 'OpenStreetMap+Microsoft ML Buildings'))[0]
rng.shuffle(osmml)
for i in osmml[:20]:
  chosen.add(i)
chosen = np.array(sorted(chosen))
print('sample', len(chosen))

with open(os.path.join(OUT, 'footprints.pkl'), 'wb') as f:
  pickle.dump(
    dict(
      ov_id=ov_id, ov_src=ov_src, ov_wkb=shapely.to_wkb(ov_geom), ov_iso=ov_iso, ov_ds=ov_ds,
      ov_ds_iou=ov_ds_iou, hgt=hgt, ds_id=ds_id, ds_h=ds_h, ds_wkb=shapely.to_wkb(ds_geom),
      ds_iso=ds_iso, sample=chosen
    ),
    f,
  )
print({s: int((ov_src[chosen] == s).sum()) for s in np.unique(ov_src[chosen])})
