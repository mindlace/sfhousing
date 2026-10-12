"""Versioned deterministic split and training-only canopy evidence."""
import hashlib
from typing import NamedTuple
import numpy as np
from shapely import points as shape_points, distance
from scipy.ndimage import binary_closing, binary_dilation
from scipy.spatial import cKDTree


class GroundResult(NamedTuple):
    groundM: float | None
    method: str
    count: int


class MaskResult(NamedTuple):
    rejected: np.ndarray
    cells: np.ndarray
    flags: list[str]
    diagnostics: list[str]


def validation_partition(source_sha: str, ordinals: np.ndarray) -> np.ndarray:
    if len(source_sha) != 64 or any(c not in '0123456789abcdef' for c in source_sha):
        raise ValueError('invalid source SHA-256')
    return np.array([int.from_bytes(hashlib.sha256(f'{source_sha}:{int(i)}'.encode('ascii')).digest()[:4], 'big') % 5 == 0 for i in ordinals], dtype=bool)


def estimate_ground(points, footprint) -> GroundResult:
    ground = points[points['classification'] == 2]
    if not len(ground):
        return GroundResult(None, 'missing', 0)
    distances = distance(footprint, shape_points(ground['x'], ground['y']))
    near = ground[distances <= 4]
    if len(near):
        return GroundResult(float(np.percentile(near['z'], 5)), 'percentile_5_within_4m', len(near))
    nearest = int(np.argmin(distances))
    if distances[nearest] <= 50:
        return GroundResult(float(ground['z'][nearest]), 'nearest_within_50m', 1)
    return GroundResult(None, 'missing', 0)


def _green_at(xy, green, transform):
    from pyproj import Transformer
    x,y = xy.T
    if transform.get('crs', 'EPSG:7131') != 'EPSG:7131':
        x,y = Transformer.from_crs('EPSG:7131', transform['crs'], always_xy=True).transform(x,y)
    if 'transform' in transform:
        a,b,c,d,e,f = transform['transform']
        uv = np.linalg.solve(np.array([[a,b],[d,e]]), np.array([x-c,y-f]))
        u,v = np.floor(uv).astype(np.int64)
    else:
        u = np.floor((x-transform['left'])/transform['pixelM']).astype(np.int64)
        v = np.floor((transform['top']-y)/transform['pixelM']).astype(np.int64)
    covered = (u >= 0)&(v >= 0)&(u < green.shape[1])&(v < green.shape[0])
    result = np.zeros(len(xy),dtype=bool)
    result[covered] = green[v[covered],u[covered]]
    return result, covered


def vegetation_mask(training_points, image, raster_transform, config) -> MaskResult:
    rejected = np.zeros(len(training_points),dtype=bool)
    empty = np.empty((0,2),dtype=np.int64)
    if image is None:
        return MaskResult(rejected, empty, ['aerial_missing'], [])
    rgb = np.asarray(image,dtype=float)
    if rgb.ndim != 3 or rgb.shape[2] < 3 or not np.isfinite(rgb).all():
        raise ValueError('invalid aerial RGB image')
    rgb = rgb[:,:,:3]
    r,g,b = rgb.transpose(2,0,1)
    green = (2*g-r-b > 15)&(g > .85*r)&(g > 1.15*b)&(g > 25)&((rgb.max(2)-rgb.min(2))/np.maximum(rgb.max(2),1) > .28)
    # Ground-equivalent morphology uses actual physical pixel size, not Web Mercator metres.
    pixel_m = raster_transform.get('groundPixelM', raster_transform.get('pixelM', .12))
    close = max(1,round(.24/pixel_m))
    dilate = max(1,round(.60/pixel_m))
    green = binary_dilation(binary_closing(green,iterations=close),iterations=dilate)
    ids = np.flatnonzero(training_points['classification'] == 1)
    if len(ids) < 3:
        return MaskResult(rejected,empty,['vegetation_ambiguous'],['pca_insufficient'])
    p = training_points[ids]
    xyz = np.column_stack([p[k] for k in ('x','y','z')])
    _, ix = cKDTree(xyz).query(xyz,k=min(48,len(xyz)))
    neighbors = xyz[ix]
    neighbors = neighbors-neighbors.mean(axis=1)[:,None,:]
    rough = np.sqrt(np.maximum(0,np.linalg.eigvalsh(np.einsum('nki,nkj->nij',neighbors,neighbors)/neighbors.shape[1])[:,0]))
    point_green, covered = _green_at(xyz[:,:2],green,raster_transform)
    safe = (rough < .025)&~point_green&covered
    if safe.sum() < 32:
        safe = (rough < .025)&covered
    if not safe.any():
        return MaskResult(rejected,empty,['vegetation_ambiguous'],['smooth_support_missing'])
    cell_m = config.get('cellM', .5)
    keys = np.floor(xyz[:,:2]/cell_m).astype(np.int64)
    unique, inverse = np.unique(keys,axis=0,return_inverse=True)
    centers = (unique+.5)*cell_m
    distances, indices = cKDTree(xyz[safe,:2]).query(centers,k=min(32,int(safe.sum())))
    distances = np.asarray(distances).reshape(len(unique),-1)
    indices = np.asarray(indices).reshape(len(unique),-1)
    support_z = np.median(xyz[safe,2][indices],axis=1)
    center_green, center_covered = _green_at(centers,green,raster_transform)
    # Only export cells whose entire extent is covered. Validation can contain
    # returns absent from training, so training-return coverage alone is insufficient.
    corners = unique[:,None,:]*cell_m+np.array([[0,0],[cell_m,0],[0,cell_m],[cell_m,cell_m]])
    _, corner_covered = _green_at(corners.reshape(-1,2),green,raster_transform)
    full_cell_coverage = corner_covered.reshape(-1,4).all(axis=1)
    bad = []
    for i, key in enumerate(unique):
        group = inverse == i
        if full_cell_coverage[i] and covered[group].all() and center_covered[i] and center_green[i] and (np.percentile(rough[group],90) > .06 or np.ptp(xyz[group,2]) > 1.5) and np.percentile(xyz[group,2],90)-support_z[i] > 2 and np.median(distances[i]) < 6:
            bad.append(key)
            rejected[ids[group]] = True
    partial = not covered.all() or not full_cell_coverage.all()
    flags = ['aerial_missing'] if partial else []
    diagnostics = ['aerial_partial_coverage'] if partial else ['aerial_complete_coverage']
    return MaskResult(rejected,np.array(bad,dtype=np.int64).reshape(-1,2),flags,diagnostics)


def apply_cells(points, cells, cell_m=.5):
    # vegetation_mask exports only fully covered cells, preserving image coverage
    # when applying a training-derived decision to previously unseen returns.
    bad = set(map(tuple,cells))
    return np.array([p['classification'] == 1 and tuple(np.floor([p['x']/cell_m,p['y']/cell_m]).astype(np.int64)) in bad for p in points],dtype=bool)
