"""Height-above-ground rasters from LiDAR and an edge-based footprint-to-LiDAR translation fit."""

import numpy as np
import shapely
import shapely.affinity
import shapely.geometry
from scipy import ndimage
from scipy.interpolate import griddata

import ept

RES = 0.25


def hag_raster(bbox):
  """Height-above-ground grid (RES m) over bbox in EPSG:7131, plus a vegetation mask.

  Row 0 is the south edge (y increases with row)."""
  pts = ept.points_7131(bbox)
  if pts is None:
    return None
  X, Y, Z, C, R, N = pts
  keep = C != 7
  X, Y, Z, C, R, N = X[keep], Y[keep], Z[keep], C[keep], R[keep], N[keep]
  x0, y0 = bbox[0], bbox[1]
  nx = int(np.ceil((bbox[2] - bbox[0]) / RES))
  ny = int(np.ceil((bbox[3] - bbox[1]) / RES))
  ix = np.clip(((X - x0) / RES).astype(int), 0, nx - 1)
  iy = np.clip(((Y - y0) / RES).astype(int), 0, ny - 1)
  lin = iy * nx + ix
  dsm = np.full(ny * nx, -np.inf)
  np.maximum.at(dsm, lin, Z)
  dsm = dsm.reshape(ny, nx)
  # vegetation: share of first returns that come from multi-return pulses
  first = R == 1
  cnt = np.bincount(lin[first], minlength=ny * nx).reshape(ny, nx).astype(float)
  multi = np.bincount(lin[first & (N > 1)], minlength=ny * nx).reshape(ny, nx).astype(float)
  k = np.ones((5, 5))
  frac = ndimage.convolve(multi, k, mode='nearest') / np.maximum(
    ndimage.convolve(cnt, k, mode='nearest'), 1
  )
  # fill DSM holes with nearest
  hole = ~np.isfinite(dsm)
  if hole.all():
    return None
  if hole.any():
    _, (ii, jj) = ndimage.distance_transform_edt(hole, return_indices=True)
    dsm = dsm[ii, jj]
  # DTM from ground points on a 1 m grid, linear interpolation
  g = C == 2
  if g.sum() < 20:
    return None
  gx = np.floor((X[g] - x0)).astype(int)
  gy = np.floor((Y[g] - y0)).astype(int)
  key = gy * 100000 + gx
  uk, inv = np.unique(key, return_inverse=True)
  zmin = np.full(len(uk), np.inf)
  np.minimum.at(zmin, inv, Z[g])
  px = (uk % 100000) + 0.5
  py = (uk // 100000) + 0.5
  cx = (np.arange(nx) + 0.5) * RES
  cy = (np.arange(ny) + 0.5) * RES
  GX, GY = np.meshgrid(cx, cy)
  dtm = griddata((px, py), zmin, (GX, GY), method='linear')
  if np.isnan(dtm).any():
    nn = griddata((px, py), zmin, (GX, GY), method='nearest')
    dtm = np.where(np.isnan(dtm), nn, dtm)
  hag = dsm - dtm
  veg = (frac > 0.35) & (hag > 1.0)
  veg = ndimage.binary_opening(veg, iterations=1)
  return dict(hag=hag, veg=veg, x0=x0, y0=y0, nx=nx, ny=ny, npts=len(X))


def boundary_samples(geom, step=0.2):
  """Points along all rings every `step` m, with outward unit normals."""
  pts, nrm = [], []
  polys = getattr(geom, 'geoms', [geom])
  for p in polys:
    if p.geom_type != 'Polygon':
      continue
    p = shapely.geometry.polygon.orient(p, 1.0)
    for ring in [p.exterior, *p.interiors]:
      c = np.asarray(ring.coords)
      for a, b in zip(c[:-1], c[1:]):
        d = b - a
        L = np.hypot(*d)
        if L < 1e-6:
          continue
        n = int(np.ceil(L / step))
        t = (np.arange(n) + 0.5) / n
        pts.append(a + t[:, None] * d)
        nrm.append(np.repeat([[d[1] / L, -d[0] / L]], n, axis=0))
  return np.concatenate(pts), np.concatenate(nrm)


def prepare(r, href):
  """Normalised raised-ness image and its gradient."""
  h = np.where(r['veg'], 0, r['hag'])
  hn = np.clip((h - 0.5) / max(0.6 * href, 1.5), 0, 1)
  hn = ndimage.gaussian_filter(hn, 1.0)
  gy, gx = np.gradient(hn, RES)
  return hn, gx, gy


def score_grid(r, gx, gy, geom, rng=3.0, step=0.1):
  P, Nn = boundary_samples(geom)
  shifts = np.arange(-rng, rng + step / 2, step)
  DX, DY = np.meshgrid(shifts, shifts)  # DY rows
  S = np.zeros(DX.shape)
  # pixel coords: col = (x - x0)/RES - 0.5, row = (y - y0)/RES - 0.5
  for i in range(DX.shape[0]):
    cols = (P[None, :, 0] + DX[i][:, None] - r['x0']) / RES - 0.5
    rows = (P[None, :, 1] + DY[i][:, None] - r['y0']) / RES - 0.5
    a = ndimage.map_coordinates(gx, [rows.ravel(), cols.ravel()], order=1, mode='nearest')
    b = ndimage.map_coordinates(gy, [rows.ravel(), cols.ravel()], order=1, mode='nearest')
    v = -(a.reshape(cols.shape) * Nn[None, :, 0] + b.reshape(cols.shape) * Nn[None, :, 1])
    S[i] = v.mean(axis=1)
  return shifts, S


def analyse_peak(shifts, S):
  i, j = np.unravel_index(np.argmax(S), S.shape)
  best = S[i, j]
  step = shifts[1] - shifts[0]

  def sub(v0, v1, v2):
    den = v0 - 2 * v1 + v2
    return 0.0 if den >= 0 else 0.5 * (v0 - v2) / den

  dx = shifts[j] + (step * sub(S[i, j - 1], S[i, j], S[i, j + 1]) if 0 < j < len(shifts) - 1 else 0)
  dy = shifts[i] + (step * sub(S[i - 1, j], S[i, j], S[i + 1, j]) if 0 < i < len(shifts) - 1 else 0)
  DX, DY = np.meshgrid(shifts, shifts)
  far = np.hypot(DX - shifts[j], DY - shifts[i]) > 1.0
  second = S[far].max() if far.any() else -np.inf
  top = S >= best - 0.1 * abs(best)
  w = np.clip(S - (best - 0.1 * abs(best)), 0, None) * top
  sx = np.sqrt((w * (DX - dx) ** 2).sum() / w.sum())
  sy = np.sqrt((w * (DY - dy) ** 2).sum() / w.sum())
  at_edge = abs(shifts[j]) >= shifts[-1] - 1e-6 or abs(shifts[i]) >= shifts[-1] - 1e-6
  return dict(
    dx=float(dx), dy=float(dy), score=float(best), second=float(second), sx=float(sx), sy=float(sy),
    at_edge=bool(at_edge), score0=float(S[len(shifts) // 2, len(shifts) // 2])
  )


def mask_of(geom, r, dx=0.0, dy=0.0):
  g = shapely.affinity.translate(geom, dx, dy)
  cx = r['x0'] + (np.arange(r['nx']) + 0.5) * RES
  cy = r['y0'] + (np.arange(r['ny']) + 0.5) * RES
  GX, GY = np.meshgrid(cx, cy)
  shapely.prepare(g)
  return shapely.contains_xy(g, GX, GY)


def iou_at(geom, r, dx, dy):
  m = mask_of(geom, r, dx, dy)
  raised = (r['hag'] > 2.0) & ~r['veg']
  # only consider raised cells within 3 m of the shifted footprint (ignore neighbours)
  near = ndimage.binary_dilation(m, iterations=int(3 / RES))
  lab, _ = ndimage.label(raised & near)
  ids = np.unique(lab[m & (lab > 0)])
  rb = np.isin(lab, ids) & near
  inter = (m & rb).sum()
  return float(inter / max((m | rb).sum(), 1))
