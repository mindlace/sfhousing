"""Compare roofer's LoD2.2 meshes with our boxes on each test set.

For every building: roofer's attributes (extrusion mode, roof type, rmse_lod22, t_run), triangle
counts (roofer LoD1.2/1.3/2.2 solids; our boxes as fill-extrusion draws them: top + walls, no
floor), and a top-surface fit to the LiDAR: class-1 points inside the registered footprint and at
least 1 m above roofer's ground, each cast straight down onto the model; RMSE and median |dz| of
the first hit, and the share of points with no model under them. Both models sit in the LiDAR
frame (our boxes moved by shift_dx/dy, except Overture parts, which the pipeline never shifts).

Writes <WORK>/<set>/compare.json, <WORK>/<set>/{roofer,ours}.glb, and figures to fig/.
Usage: compare.py <set> [<set> ...]
"""

import glob
import gzip
import json
import os
import sys

import duckdb
import geopandas as gpd
import laspy
import mapbox_earcut as earcut
import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import shapely  # noqa: E402
import trimesh  # noqa: E402
from mpl_toolkits.mplot3d.art3d import Poly3DCollection  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import BOXES, ROOFS, SPIKE, WORK  # noqa: E402

FIG = os.path.join(SPIKE, 'fig')
LIGHT = np.array([-0.4, -0.6, 0.7])
LIGHT /= np.linalg.norm(LIGHT)


# ---------- geometry helpers


def tri_polygon3d(rings):
  """Triangulate a planar 3D polygon (outer ring + holes, each an (n,3) array)."""
  pts = np.vstack(rings)
  if len(pts) < 3:
    return pts, np.zeros((0, 3), int)
  n = np.zeros(3)
  r0 = rings[0]
  for i in range(len(r0)):  # Newell normal
    a, b = r0[i], r0[(i + 1) % len(r0)]
    n += [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]
  if np.linalg.norm(n) < 1e-12:
    return pts, np.zeros((0, 3), int)
  n /= np.linalg.norm(n)
  u = np.cross(n, [0, 0, 1] if abs(n[2]) < 0.9 else [1, 0, 0])
  u /= np.linalg.norm(u)
  v = np.cross(n, u)
  p2 = np.column_stack([(pts - pts.mean(0)) @ u, (pts - pts.mean(0)) @ v])
  ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
  t = earcut.triangulate_float64(p2, ends).reshape(-1, 3)
  return pts, t


def extrude(poly, z0, z1):
  """Fill-extrusion triangles of a shapely (Multi)Polygon: top + walls, no floor."""
  V, F = [], []
  for p in getattr(poly, 'geoms', [poly]):
    if p.geom_type != 'Polygon' or p.is_empty:
      continue
    rings = [np.asarray(p.exterior.coords)[:-1]] + [np.asarray(r.coords)[:-1] for r in p.interiors]
    ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
    p2 = np.vstack(rings)
    t = earcut.triangulate_float64(p2, ends).reshape(-1, 3)
    off = sum(len(v) for v in V)
    V.append(np.column_stack([p2, np.full(len(p2), z1)]))
    F.append(t + off)
    for r in rings:
      for i in range(len(r)):
        a, b = r[i], r[(i + 1) % len(r)]
        off = sum(len(v) for v in V)
        V.append(np.array([[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]]))
        F.append(np.array([[0, 1, 2], [0, 2, 3]]) + off)
  if not V:
    return None
  return trimesh.Trimesh(np.vstack(V), np.vstack(F), process=False)


# ---------- loaders


def load_roofer(name):
  out = {}
  for p in sorted(glob.glob(os.path.join(WORK, name, 'out', '*.jsonl'))):
    lines = open(p).read().splitlines()
    tr = json.loads(lines[0])['transform']
    for line in lines[1:]:
      d = json.loads(line)
      V = np.asarray(d['vertices'], float) * tr['scale'] + tr['translate']
      bld = next(o for o in d['CityObjects'].values() if o['type'] == 'Building')
      rec = {'attrs': bld['attributes'], 'mesh': {}, 'roofmask': {}}
      for o in d['CityObjects'].values():
        for g in o.get('geometry', []):
          if g['type'] != 'Solid':
            continue
          sem = g.get('semantics', {})
          stypes = [s['type'] for s in sem.get('surfaces', [])]
          svals = sem.get('values', [[None] * len(g['boundaries'][0])])[0]
          Vs, Fs, roof = [], [], []
          off = 0
          for si, surf in enumerate(g['boundaries'][0]):
            rings = [V[np.asarray(r)] for r in surf]
            pts, t = tri_polygon3d(rings)
            Vs.append(pts)
            Fs.append(t + off)
            off += len(pts)
            st = stypes[svals[si]] if svals[si] is not None else None
            roof += [st == 'RoofSurface'] * len(t)
          lod = str(g['lod'])
          if Vs:
            m = trimesh.Trimesh(np.vstack(Vs), np.vstack(Fs), process=False)
            if lod in rec['mesh']:
              rec['roofmask'][lod] = np.concatenate([rec['roofmask'][lod], roof])
              rec['mesh'][lod] = trimesh.util.concatenate([rec['mesh'][lod], m])
            else:
              rec['mesh'][lod], rec['roofmask'][lod] = m, np.array(roof)
      out[bld['attributes']['bid']] = rec
  return out


def load_ours(fp):
  bids = list(fp.bid)
  q = ','.join(f"'{b}'" for b in bids)
  con = duckdb.connect()
  boxes = con.sql(
    f"select bid, k, src, base_m, height_m, geom from read_parquet('{BOXES}') where bid in ({q})"
  ).fetchall()
  roofs = {
    r[0]: r[1:]
    for r in con.sql(
      f"select bid, ground_m, shift_dx, shift_dy, fallback from read_parquet('{ROOFS}') where bid in ({q})"
    ).fetchall()
  }
  geom = dict(zip(fp.bid, fp.geometry))
  out = {}
  for bid, k, src, base, h, wkb in boxes:
    ground, dx, dy, _ = roofs[bid]
    if wkb is None:
      poly = geom[bid]
    else:
      poly = shapely.from_wkb(bytes(wkb))
      if src != 'part':
        poly = shapely.affinity.translate(poly, dx or 0, dy or 0)
    m = extrude(poly, ground + base, ground + h)
    if m is not None:
      out.setdefault(bid, []).append(m)
  res = {}
  for bid, ms in out.items():
    m = trimesh.util.concatenate(ms)
    roof = np.abs(m.face_normals[:, 2]) > 0.99
    res[bid] = {'mesh': m, 'roofmask': roof, 'fallback': roofs[bid][3]}
  for bid in bids:
    if bid not in res:
      res[bid] = {'mesh': None, 'roofmask': None, 'fallback': roofs[bid][3]}
  return res


def load_points(name):
  xs = []
  for p in sorted(glob.glob(os.path.join(WORK, name, 'pc', '*.laz'))):
    las = laspy.read(p)
    xs.append(np.column_stack([las.x, las.y, las.z, las.classification]))
  return np.vstack(xs)


# ---------- metrics


def dsm(pts, cell=0.5):
  """Top surface of the points: highest point per cell, as (x, y, z) at the cell centre."""
  if len(pts) == 0:
    return pts
  ij = np.floor(pts[:, :2] / cell).astype(np.int64)
  key = ij[:, 0] * 10_000_000 + ij[:, 1]
  order = np.lexsort((-pts[:, 2], key))
  k = key[order]
  first = np.r_[True, k[1:] != k[:-1]]
  sel = order[first]
  c = (ij[sel] + 0.5) * cell
  return np.column_stack([c, pts[sel, 2]])


def top_fit(mesh, pts):
  """RMSE / median |dz| of the DSM cells to the model's first surface from above; miss share."""
  if mesh is None or len(pts) == 0:
    return None
  pts = dsm(pts)
  origins = np.column_stack([pts[:, 0], pts[:, 1], np.full(len(pts), 2000.0)])
  dirs = np.tile([0, 0, -1.0], (len(pts), 1))
  loc, idx_ray, _ = mesh.ray.intersects_location(origins, dirs, multiple_hits=False)
  ztop = np.full(len(pts), np.nan)
  ztop[idx_ray] = loc[:, 2]
  hit = ~np.isnan(ztop)
  dz = pts[hit, 2] - ztop[hit]
  return {
    'n': int(len(pts)),
    'rmse': float(np.sqrt(np.mean(dz**2))) if hit.any() else None,
    'mad': float(np.median(np.abs(dz))) if hit.any() else None,
    'within_1m': float(np.mean(np.abs(dz) < 1)) if hit.any() else None,
    'miss': float(1 - hit.mean()),
  }


def glb_bytes(meshes):
  ms = [m for m in meshes if m is not None]
  if not ms:
    return 0, 0
  scene = trimesh.Scene()
  for i, m in enumerate(ms):
    mm = m.copy()
    mm.merge_vertices()
    mm.vertices -= mm.vertices.mean(0)
    scene.add_geometry(mm, node_name=f'b{i}')
  b = scene.export(file_type='glb')
  return len(b), len(gzip.compress(b, 6))


# ---------- figures


def draw(ax, meshes, roofmasks, c0, lim, title):
  for m, rm in zip(meshes, roofmasks):
    if m is None:
      continue
    tri = m.vertices[m.faces] - c0
    n = m.face_normals
    shade = 0.45 + 0.55 * np.clip(np.abs(n @ LIGHT), 0, 1)
    base = np.where(rm[:, None], [[0.80, 0.45, 0.35]], [[0.85, 0.85, 0.82]])
    col = np.clip(base * shade[:, None], 0, 1)
    pc = Poly3DCollection(tri, facecolors=col, edgecolors=(0, 0, 0, 0.12), linewidths=0.15)
    ax.add_collection3d(pc)
  style(ax, lim, title)


def style(ax, lim, title):
  (x0, x1), (y0, y1), (z0, z1) = lim
  ax.set_xlim(x0, x1)
  ax.set_ylim(y0, y1)
  ax.set_zlim(z0, z1)
  ax.set_box_aspect((x1 - x0, y1 - y0, z1 - z0))
  ax.view_init(elev=28, azim=-58)
  ax.set_axis_off()
  ax.set_title(title, fontsize=9)


def draw_points(ax, pts, c0, lim, title, nmax=120000):
  p = pts[pts[:, 3] == 1]
  if len(p) > nmax:
    p = p[np.random.default_rng(0).choice(len(p), nmax, replace=False)]
  ax.scatter(p[:, 0] - c0[0], p[:, 1] - c0[1], p[:, 2] - c0[2], c=p[:, 2], s=0.15, cmap='viridis',
             linewidths=0)
  style(ax, lim, title)


def limits(meshes, pad=3):
  vs = np.vstack([m.vertices for m in meshes if m is not None])
  lo, hi = vs.min(0) - pad, vs.max(0) + pad
  return lo, hi


def figure_set(name, fp, rf, ours, pts, ground):
  bids = list(fp.bid)
  rm = [rf.get(b, {}).get('mesh', {}).get('2.2') for b in bids]
  rr = [rf.get(b, {}).get('roofmask', {}).get('2.2') for b in bids]
  om = [ours[b]['mesh'] for b in bids]
  orr = [ours[b]['roofmask'] for b in bids]
  lo, hi = limits(rm + om)
  lo[2] = ground
  c0 = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, ground])
  lim = [(lo[0] - c0[0], hi[0] - c0[0]), (lo[1] - c0[1], hi[1] - c0[1]), (0, hi[2] - ground)]
  box = shapely.box(lo[0], lo[1], hi[0], hi[1])
  inside = shapely.contains_xy(box, pts[:, 0], pts[:, 1])
  tall = hi[2] - ground > 120
  fig = plt.figure(figsize=(15, 9 if tall else 5.6), dpi=130)
  for i, (fn, t) in enumerate(
    [
      (lambda ax: draw_points(ax, pts[inside], c0, lim, 'LiDAR 2023 (class 1)'), 0),
      (lambda ax: draw(ax, om, orr, c0, lim, 'ours: boxes (as fill-extrusion)'), 1),
      (lambda ax: draw(ax, rm, rr, c0, lim, 'roofer LoD2.2'), 2),
    ]
  ):
    ax = fig.add_subplot(1, 3, i + 1, projection='3d')
    fn(ax)
  fig.suptitle(name, fontsize=11)
  fig.subplots_adjust(left=0, right=1, bottom=0, top=0.93, wspace=0)
  fig.savefig(os.path.join(FIG, f'{name}.png'))
  plt.close(fig)


def figure_detached(name, fp, rf, ours, pts):
  bids = list(fp.bid)
  fig = plt.figure(figsize=(16, 20), dpi=110)
  for i, b in enumerate(bids):
    poly = fp.geometry.iloc[i]
    pm = [rf.get(b, {}).get('mesh', {}).get('2.2'), ours[b]['mesh']]
    if all(m is None for m in pm):
      continue
    lo, hi = limits(pm, pad=1)
    g = rf.get(b, {}).get('attrs', {}).get('rf_h_ground', lo[2])
    c0 = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, g])
    lim = [(lo[0] - c0[0], hi[0] - c0[0]), (lo[1] - c0[1], hi[1] - c0[1]), (0, hi[2] - g)]
    for j, (m, rmk, t) in enumerate(
      [
        (ours[b]['mesh'], ours[b]['roofmask'], 'ours'),
        (pm[0], rf.get(b, {}).get('roofmask', {}).get('2.2'), 'roofer'),
      ]
    ):
      ax = fig.add_subplot(10, 4, 2 * i + j + 1, projection='3d')
      draw(ax, [m], [rmk], c0, lim, f'{i}: {t}')
  fig.subplots_adjust(left=0, right=1, bottom=0, top=0.98, wspace=0, hspace=0.05)
  fig.savefig(os.path.join(FIG, f'{name}.png'))
  plt.close(fig)


def main(name):
  fp = gpd.read_file(os.path.join(WORK, name, 'footprints.gpkg'))
  rf = load_roofer(name)
  ours = load_ours(fp)
  pts = load_points(name)
  pts = pts[np.isin(pts[:, 3], [1, 2])]
  rows = []
  for i, b in enumerate(fp.bid):
    poly = fp.geometry.iloc[i]
    a = rf.get(b, {}).get('attrs', {})
    g = a.get('rf_h_ground')
    inside = shapely.contains_xy(poly, pts[:, 0], pts[:, 1]) & (pts[:, 3] == 1)
    p = pts[inside]
    if g is not None:
      p = p[p[:, 2] > g + 1]
    rmesh = rf.get(b, {}).get('mesh', {})
    rows.append(
      {
        'bid': b,
        'area_m2': round(poly.area, 1),
        'roofer_present': b in rf,
        'extrusion_mode': a.get('rf_extrusion_mode'),
        'roof_type': a.get('rf_roof_type'),
        'success': a.get('rf_success'),
        't_run_ms': a.get('rf_t_run'),
        'rf_rmse_lod22': a.get('rf_rmse_lod22'),
        'roof_planes': a.get('rf_roof_planes'),
        'h_ground': g,
        'tri_lod12': len(rmesh['1.2'].faces) if '1.2' in rmesh else None,
        'tri_lod13': len(rmesh['1.3'].faces) if '1.3' in rmesh else None,
        'tri_lod22': len(rmesh['2.2'].faces) if '2.2' in rmesh else None,
        'tri_ours': len(ours[b]['mesh'].faces) if ours[b]['mesh'] is not None else None,
        'ours_fallback': ours[b]['fallback'],
        'fit_roofer': top_fit(rmesh.get('2.2'), p),
        'fit_ours': top_fit(ours[b]['mesh'], p),
      }
    )
  rg = glb_bytes([rf.get(b, {}).get('mesh', {}).get('2.2') for b in fp.bid])
  og = glb_bytes([ours[b]['mesh'] for b in fp.bid])
  for fname, ms in [
    ('roofer.glb', [rf.get(b, {}).get('mesh', {}).get('2.2') for b in fp.bid]),
    ('ours.glb', [ours[b]['mesh'] for b in fp.bid]),
  ]:
    ms = [m for m in ms if m is not None]
    if ms:
      trimesh.util.concatenate(ms).export(os.path.join(WORK, name, fname))
  summary = {'set': name, 'glb_roofer': rg, 'glb_ours': og, 'buildings': rows}
  with open(os.path.join(WORK, name, 'compare.json'), 'w') as f:
    json.dump(summary, f, indent=1)
  grounds = [r['h_ground'] for r in rows if r['h_ground'] is not None]
  if name.startswith('detached'):
    figure_detached(name, fp, rf, ours, pts)
  else:
    figure_set(name, fp, rf, ours, pts, min(grounds) if grounds else float(pts[:, 2].min()))
  print(name, 'done', len(rows))


if __name__ == '__main__':
  for n in sys.argv[1:]:
    main(n)
