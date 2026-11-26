"""Pick the test sets, write registered footprints (GPKG, EPSG:7131) and LAZ crops per set.

Footprints are Overture's, projected to EPSG:7131 and moved by the building's registration shift
(roofs.parquet shift_dx/dy: footprint + shift = LiDAR frame), so roofer sees them where the points
are. Writes <WORK>/<set>/footprints.gpkg and <WORK>/<set>/pc/*.laz, and <WORK>/sets.json.
"""

import json
import os
import sys

import duckdb
import geopandas as gpd
import numpy as np
import shapely

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import BOXES, OVERTURE, ROOFS, T_LL_7131, WORK, points_7131, write_laz  # noqa: E402

PAD = 12.0  # m of points around each set: roofer's terrain buffer is 4 m


def ll(lng, lat):
  return shapely.Point(*T_LL_7131.transform(lng, lat))


con = duckdb.connect()
con.sql('INSTALL spatial; LOAD spatial;')
rows = con.sql(
  f"""select b.id, ST_AsWKB(b.geom), r.shift_dx, r.shift_dy, r.roof, r.fallback, r.ground_m
  from read_parquet('{OVERTURE}') b join read_parquet('{ROOFS}') r on r.bid = b.id"""
).fetchall()
bid = np.array([r[0] for r in rows])
g = shapely.from_wkb([bytes(r[1]) for r in rows])
g = shapely.transform(g, lambda xy: np.column_stack(T_LL_7131.transform(xy[:, 0], xy[:, 1])))
g = shapely.make_valid(g)
dx = np.array([r[2] or 0.0 for r in rows])
dy = np.array([r[3] or 0.0 for r in rows])
roof = np.array([r[4] for r in rows])
fallback = np.array([r[5] for r in rows])
reg = np.array([shapely.affinity.translate(a, x, y) for a, x, y in zip(g, dx, dy)])
tree = shapely.STRtree(g)
print('buildings', len(bid))

sets = {}


def contains(pt):
  idx = tree.query(pt, predicate='intersects')
  assert len(idx) >= 1, 'no footprint contains the point'
  return [int(idx[np.argmax(shapely.area(g[idx]))])]


def window(lng, lat, hx, hy):
  c = ll(lng, lat)
  box = shapely.box(c.x - hx, c.y - hy, c.x + hx, c.y + hy)
  idx = tree.query(box, predicate='intersects')
  cen = shapely.centroid(g[idx])
  keep = shapely.contains(box, cen)
  return [int(i) for i in idx[keep]]


sets['salesforce'] = contains(ll(-122.3969, 37.7897))
sets['sutro'] = [int(np.where(bid == 'c5cbfced-fe3d-43ce-9d7a-63302127f0f9')[0][0])]
# Downtown south of Mission between 1st and Fremont/Beale: 181 Fremont, Park Tower, podiums.
sets['downtown'] = window(-122.3949, 37.7887, 110, 110)
# The offset spike's Noe Valley rowhouse block (rowhouse.py BLOCKS[1]).
sets['rowhouse'] = window(-122.4310, 37.7505, 95, 45)

# Detached pitched houses: nearest other footprint over 2 m away, 70-400 m2, registered by a fit.
d_other = np.full(len(g), np.inf)
ii, dist = tree.query_nearest(g, return_distance=True, exclusive=True, all_matches=False)
d_other[ii[0]] = dist
shift_src = dict(
  con.sql(f"select bid, shift_source from read_parquet('{ROOFS}')").fetchall()
)
area = shapely.area(g)
cand = np.where(
  (roof == 'pitched')
  & (d_other > 2)
  & (area > 70)
  & (area < 400)
  & np.array([shift_src.get(b) == 'fit' for b in bid])
)[0]
rng = np.random.default_rng(20261126)
sets['detached'] = [int(i) for i in rng.choice(cand, 20, replace=False)]
print({k: len(v) for k, v in sets.items()}, 'detached candidates', len(cand))

meta = {}
for name, idx in sets.items():
  d = os.path.join(WORK, name)
  os.makedirs(os.path.join(d, 'pc'), exist_ok=True)
  gdf = gpd.GeoDataFrame(
    {
      'bid': bid[idx],
      'shift_dx': dx[idx],
      'shift_dy': dy[idx],
      'roof': roof[idx],
      'fallback': fallback[idx],
    },
    geometry=list(reg[idx]),
    crs='EPSG:7131',
  )
  # roofer wants simple polygons; keep the largest polygon of a multipolygon.
  gdf['geometry'] = [
    max(p.geoms, key=lambda q: q.area) if p.geom_type != 'Polygon' else p
    for p in (shapely.make_valid(x) for x in gdf.geometry)
  ]
  gdf['geometry'] = [
    max([q for q in getattr(p, 'geoms', [p]) if q.geom_type == 'Polygon'], key=lambda q: q.area)
    for p in gdf.geometry
  ]
  gdf.to_file(os.path.join(d, 'footprints.gpkg'), driver='GPKG', layer='footprints')
  # One crop per set, or per house for the scattered detached sample.
  groups = [[i] for i in range(len(idx))] if name == 'detached' else [list(range(len(idx)))]
  n_pts = 0
  for gi, grp in enumerate(groups):
    b = shapely.total_bounds(gdf.geometry.iloc[grp].values)
    bb = (b[0] - PAD, b[1] - PAD, b[2] + PAD, b[3] + PAD)
    p = points_7131(bb)
    write_laz(os.path.join(d, 'pc', f'{gi:03d}.laz'), p)
    n_pts += len(p['x'])
    if gi == 0:
      u, c = np.unique(p['cls'], return_counts=True)
      print(name, 'classes', dict(zip(u.tolist(), c.tolist())))
  meta[name] = dict(n=len(idx), points=n_pts, bids=bid[idx].tolist())
  print(name, len(idx), 'buildings', n_pts, 'points')

with open(os.path.join(WORK, 'sets.json'), 'w') as f:
  json.dump(meta, f, indent=1)
