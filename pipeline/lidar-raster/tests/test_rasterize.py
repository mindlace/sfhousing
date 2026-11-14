"""Rasterizer tests on tiny synthetic LAS files (EPSG:3857, like the EPT nodes they replace)."""

import json
import os

import laspy
import numpy as np
import pytest
from pyproj import Transformer

from sfh_lidar import rasterize

NODATA = -32768
SIZE = 100
RES = 0.25
TX, TY = 506, 266
X0, Y0 = TX * SIZE, TY * SIZE  # tile (506, 266): x 50600..50700, y 26600..26700 in EPSG:7131
TO_3857 = Transformer.from_crs('EPSG:7131', 'EPSG:3857', always_xy=True)

# Scene, EPSG:7131 metres: 60 x 60 m of ground at z 20, a 10 x 10 m roof at z 30,
# a 4 m tree disc and a 5 m square with no returns at all.
SCENE = (X0 + 20, Y0 + 20, X0 + 80, Y0 + 80)
ROOF = (X0 + 30, Y0 + 30, X0 + 40, Y0 + 40)
TREE = (X0 + 65, Y0 + 65, 2.0)
HOLE = (X0 + 45, Y0 + 45, X0 + 50, Y0 + 50)


def write_las(path, x, y, z, cls, ret, nret):
  """Write points given in EPSG:7131 as an EPSG:3857 LAS 1.4 file."""
  X, Y = TO_3857.transform(np.asarray(x, float), np.asarray(y, float))
  header = laspy.LasHeader(point_format=6, version='1.4')
  header.offsets = [np.floor(X.min()), np.floor(Y.min()), 0.0]
  header.scales = [0.001, 0.001, 0.001]
  las = laspy.LasData(header)
  las.x = X
  las.y = Y
  las.z = np.asarray(z, float)
  las.classification = np.asarray(cls, np.uint8)
  las.return_number = np.asarray(ret, np.uint8)
  las.number_of_returns = np.asarray(nret, np.uint8)
  las.write(str(path))


def lattice(box):
  xs = np.arange(box[0] + RES / 2, box[2], RES)
  ys = np.arange(box[1] + RES / 2, box[3], RES)
  gx, gy = np.meshgrid(xs, ys)
  return gx.ravel(), gy.ravel()


def inside(x, y, box):
  return (x >= box[0]) & (x < box[2]) & (y >= box[1]) & (y < box[3])


def scene(tree=False, hole=False, veg_class=None):
  """Points (x, y, z, cls, ret, nret) for the scene."""
  x, y = lattice(SCENE)
  keep = np.ones(x.size, bool)
  if hole:
    keep &= ~inside(x, y, HOLE)
  x, y = x[keep], y[keep]
  roof = inside(x, y, ROOF)
  z = np.where(roof, 30.0, 20.0)
  cls = np.where(roof, 6, 2)
  ret = np.ones(x.size)
  nret = np.ones(x.size)
  parts = [(x, y, z, cls, ret, nret)]
  if tree or veg_class is not None:
    cx, cy, r = TREE
    disc = np.hypot(x - cx, y - cy) <= r
    tx_, ty_ = x[disc], y[disc]
    n = tx_.size
    if veg_class is None:
      # Three-return pulses: canopy (first), mid-canopy, ground (class 2).
      parts = [tuple(a[~disc] for a in parts[0])]
      parts.append((tx_, ty_, np.full(n, 28.0), np.ones(n), np.ones(n), np.full(n, 3)))
      parts.append((tx_, ty_, np.full(n, 24.0), np.ones(n), np.full(n, 2), np.full(n, 3)))
      parts.append((tx_, ty_, np.full(n, 20.0), np.full(n, 2), np.full(n, 3), np.full(n, 3)))
    else:
      # A classified shrub: single returns of the given vegetation class, 0.5 m tall.
      parts = [tuple(a[~disc] for a in parts[0])]
      parts.append(
        (tx_, ty_, np.full(n, 20.5), np.full(n, veg_class), np.ones(n), np.ones(n))
      )
  # Noise (classes 7 and 18) high over the roof: must be dropped.
  parts.append(
    (
      np.array([X0 + 35.125, X0 + 35.375]),
      np.array([Y0 + 35.125, Y0 + 35.125]),
      np.array([90.0, 95.0]),
      np.array([7, 18]),
      np.ones(2),
      np.ones(2),
    )
  )
  return tuple(np.concatenate(a) for a in zip(*parts))


def run(tmp_path, pts, extra=()):
  las = tmp_path / 'scene.las'
  write_las(las, *pts)
  out = tmp_path / 'out'
  code = rasterize.main(
    [
      '--out', str(out),
      '--tiles', f'{TX}_{TY}',
      '--size', str(SIZE),
      '--res', str(RES),
      '--ground-res', '1',
      '--pad', '20',
      '--veg-frac', '0.35',
      '--las', str(las),
      *extra,
    ]
  )
  assert code == 0
  return out / f'{TX}_{TY}'


def load(d):
  meta = json.loads((d / 'tile.json').read_text())
  hag = np.fromfile(d / 'hag.i16', '<i2').reshape(meta['ny'], meta['nx'])
  ground = np.fromfile(d / 'ground.i16', '<i2').reshape(meta['gny'], meta['gnx'])
  veg = np.fromfile(d / 'veg.u8', np.uint8).reshape(meta['ny'], meta['nx'])
  return meta, hag, ground, veg


def cells(box, res=RES):
  """(rows, cols) slices of the cells whose centres lie in box (row 0 = south)."""
  c0 = int(np.ceil((box[0] - X0) / res - 0.5))
  c1 = int(np.floor((box[2] - X0) / res - 0.5))
  r0 = int(np.ceil((box[1] - Y0) / res - 0.5))
  r1 = int(np.floor((box[3] - Y0) / res - 0.5))
  return slice(r0, r1 + 1), slice(c0, c1 + 1)


def cell(x, y, res=RES):
  return int((y - Y0) // res), int((x - X0) // res)


def shrink(box, m):
  return (box[0] + m, box[1] + m, box[2] - m, box[3] - m)


def test_flat_roof_box(tmp_path):
  meta, hag, ground, veg = load(run(tmp_path, scene()))
  assert meta == {
    'tx': TX,
    'ty': TY,
    'sizeM': SIZE,
    'res': RES,
    'groundRes': 1,
    'nx': 400,
    'ny': 400,
    'gnx': 100,
    'gny': 100,
    'points': meta['points'],
  }
  assert meta['points'] > 0
  roof = hag[cells(shrink(ROOF, 0.5))]
  assert roof.size > 1000
  assert np.abs(roof.astype(int) - 1000).max() <= 5
  assert np.abs(ground[cells(SCENE, 1)].astype(int) - 2000).max() <= 5
  assert np.abs(hag[cells(shrink((X0 + 50, Y0 + 50, X0 + 75, Y0 + 75), 0.5))]).max() <= 5
  assert veg.max() == 0
  # Outside the scene by more than 1 m: no data. Ground is filled everywhere (nearest).
  assert hag[cell(X0 + 5, Y0 + 5)] == NODATA
  assert abs(int(ground[cell(X0 + 5, Y0 + 5, 1)]) - 2000) <= 5


def test_tree_flags_veg(tmp_path):
  meta, hag, ground, veg = load(run(tmp_path, scene(tree=True)))
  cx, cy, _ = TREE
  assert veg[cell(cx, cy)] == 1
  assert abs(int(hag[cell(cx, cy)]) - 800) <= 5
  assert veg[cells(ROOF)].max() == 0


def test_veg_classes_flag_veg(tmp_path):
  meta, hag, ground, veg = load(run(tmp_path, scene(veg_class=4)))
  cx, cy, _ = TREE
  assert veg[cell(cx, cy)] == 1
  assert abs(int(hag[cell(cx, cy)]) - 50) <= 5
  assert veg[cells(ROOF)].max() == 0


def test_nodata_beyond_one_metre(tmp_path):
  meta, hag, ground, veg = load(run(tmp_path, scene(hole=True)))
  assert hag[cell(X0 + 47.5, Y0 + 47.5)] == NODATA
  edge = hag[cell(HOLE[0] + 0.5, Y0 + 47.5)]
  assert edge != NODATA
  assert abs(int(edge)) <= 5
  # The ground grid is interpolated across the hole.
  assert abs(int(ground[cell(X0 + 47.5, Y0 + 47.5, 1)]) - 2000) <= 5


def test_empty_tile_writes_only_meta(tmp_path):
  pts = scene()
  las = tmp_path / 'scene.las'
  write_las(las, *pts)
  out = tmp_path / 'out'
  code = rasterize.main(
    ['--out', str(out), '--tiles', f'{TX + 3}_{TY}', '--size', str(SIZE), '--las', str(las)]
  )
  assert code == 0
  d = out / f'{TX + 3}_{TY}'
  assert sorted(os.listdir(d)) == ['tile.json']
  assert json.loads((d / 'tile.json').read_text())['points'] == 0


def test_resume_and_dry_run(tmp_path, capsys):
  d = run(tmp_path, scene())
  stamp = (d / 'hag.i16').stat().st_mtime_ns
  run(tmp_path, scene())
  assert (d / 'hag.i16').stat().st_mtime_ns == stamp
  capsys.readouterr()
  las = tmp_path / 'scene.las'
  code = rasterize.main(
    [
      '--out', str(tmp_path / 'dry'),
      '--tiles', f'{TX}_{TY},{TX + 3}_{TY}',
      '--size', str(SIZE),
      '--las', str(las),
      '--dry-run',
    ]
  )
  assert code == 0
  lines = capsys.readouterr().out.strip().splitlines()
  assert lines[0].startswith(f'tile {TX}_{TY} nodes 1 points ')
  assert int(lines[0].split()[-1]) > 0
  assert lines[1].startswith(f'tile {TX + 3}_{TY} nodes ')
  assert not (tmp_path / 'dry').exists()


def test_parallel_jobs_match_serial(tmp_path):
  d = run(tmp_path, scene(tree=True))
  las = tmp_path / 'scene.las'
  out = tmp_path / 'par'
  tiles = f'{TX}_{TY},{TX + 3}_{TY}'
  code = rasterize.main(
    ['--out', str(out), '--tiles', tiles, '--size', str(SIZE), '--las', str(las), '--jobs', '2']
  )
  assert code == 0
  for f in ('hag.i16', 'ground.i16', 'veg.u8', 'tile.json'):
    assert (out / d.name / f).read_bytes() == (d / f).read_bytes()
  assert json.loads((out / f'{TX + 3}_{TY}' / 'tile.json').read_text())['points'] == 0
  assert not [p for p in os.listdir(out) if p.startswith('.')]


def test_crs_matches_duckdb():
  # DuckDB: ST_Transform(ST_Point(-122.4194, 37.7749), 'EPSG:4326', 'EPSG:7131', always_xy := true)
  want = (50695.887, 26764.161)
  x, y = Transformer.from_crs('EPSG:4326', 'EPSG:7131', always_xy=True).transform(
    -122.4194, 37.7749
  )
  assert x == pytest.approx(want[0], abs=0.01)
  assert y == pytest.approx(want[1], abs=0.01)
  mx, my = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True).transform(
    -122.4194, 37.7749
  )
  x, y = rasterize.TO_7131.transform(mx, my)
  assert x == pytest.approx(want[0], abs=0.01)
  assert y == pytest.approx(want[1], abs=0.01)
