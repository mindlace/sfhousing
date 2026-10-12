"""Offline input identity and geometry. No upstream access is permitted here."""
import hashlib
import json
import math
from pathlib import Path
import sys
import numpy as np


def _ring(points, ccw, allow_collapsed=False):
    snapped = []
    for p in points:
        if len(p) < 2 or not all(math.isfinite(x) for x in p[:2]):
            raise ValueError('invalid footprint coordinate')
        q = tuple(int(math.floor(x * 1000 + 0.5)) for x in p[:2])
        if not snapped or q != snapped[-1]:
            snapped.append(q)
    if len(snapped) > 1 and snapped[0] == snapped[-1]:
        snapped.pop()
    if allow_collapsed and snapped:
        area = sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(snapped,snapped[1:]+snapped[:1]))
        if len(set(snapped)) < 3 or not area:
            # Identity retains collapsed rings as canonical snapped sequences.
            # Exact Boolean geometry is never reconstructed from this encoding.
            seq = min(seq[i:]+seq[:i] for seq in (snapped,snapped[::-1]) for i in range(len(seq)))
            return [[v/1000 if v else 0 for v in p] for p in seq+[seq[0]]]
    if len(set(snapped)) < 3:
        raise ValueError('degenerate snapped ring')
    area = sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(snapped,snapped[1:]+snapped[:1]))
    if not area:
        raise ValueError('zero area footprint ring')
    if (area > 0) != ccw:
        snapped.reverse()
    rotations = [snapped[i:]+snapped[:i] for i,p in enumerate(snapped) if p == min(snapped)]
    snapped = min(rotations)
    return [[(v/1000 if v else 0) for v in p] for p in snapped+[snapped[0]]]


def canonical_geometry(geojson: dict, allow_collapsed=False) -> dict:
    kind = geojson['type']
    if kind not in ('Polygon','MultiPolygon'):
        raise ValueError('footprints must be polygonal')
    polygons = [geojson['coordinates']] if kind == 'Polygon' else geojson['coordinates']
    normalized = []
    for rings in polygons:
        if not rings:
            raise ValueError('empty polygon')
        normalized.append([_ring(rings[0],True,allow_collapsed)]+sorted(_ring(h,False,allow_collapsed) for h in rings[1:]))
    normalized.sort()
    return {'type':kind,'coordinates':normalized[0] if kind == 'Polygon' else normalized}


def footprint_hash(geojson: dict) -> str:
    # Sort keys and disallow NaN; Unicode is encoded directly as UTF-8.
    data = json.dumps(canonical_geometry(geojson),sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
    return hashlib.sha256(data.encode('utf-8')).hexdigest()


def make_piece_id(building_id: str, parcel_id: str | None, geometry: dict) -> str:
    data = json.dumps([building_id,parcel_id,canonical_geometry(geometry,allow_collapsed=True)],sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
    return 'p-'+hashlib.sha256(data.encode('utf-8')).hexdigest()[:24]


POINT_DTYPE = np.dtype([('x','<f8'),('y','<f8'),('z','<f8'),('classification','u1'),
                       ('sourceSha','U64'),('ordinal','<u8')])


def consistent_sources(sources):
    """Identical aliases share bytes; conflicting effective metadata is an integrity error."""
    result = {}
    fields = ('horizontalCrs','verticalCrs','horizontalUnits','verticalUnits','supportBufferM','coverage')
    for source in sources:
        if source['kind'] != 'lidar': continue
        sha = source['sha256']
        if sha in result and any(result[sha].get(k) != source.get(k) for k in fields):
            raise ValueError('conflicting LiDAR source metadata')
        result.setdefault(sha,source)
    return result


def decode_source(source):
    """Decode one whole original node using the pinned, shared coordinate recipe."""
    import laspy
    from pyproj import Transformer
    if source['horizontalCrs'] not in ('EPSG:7131','EPSG:3857') or any(source.get(k,'m') != 'm' for k in ('horizontalUnits','verticalUnits')):
        raise ValueError('unsupported LiDAR CRS/units')
    path = Path(source['path'])
    with path.open('rb') as stream:
        if hashlib.file_digest(stream,'sha256').hexdigest() != source['sha256']:
            raise ValueError('LiDAR sha256 mismatch')
    las = laspy.read(path)
    a = np.empty(len(las.points),dtype=POINT_DTYPE)
    x,y = np.asarray(las.x),np.asarray(las.y)
    if source['horizontalCrs'] != 'EPSG:7131':
        x,y = Transformer.from_crs(source['horizontalCrs'],'EPSG:7131',always_xy=True).transform(x,y)
    a['x'],a['y'],a['z'] = x,y,np.asarray(las.z)
    a['classification'] = np.asarray(las.classification)
    a['sourceSha'] = source['sha256']
    a['ordinal'] = np.arange(len(a),dtype=np.uint64)
    if not all(np.isfinite(a[k]).all() for k in ('x','y','z')):
        raise ValueError('nonfinite LiDAR point')
    return a


def load_points(job: dict) -> dict[str, np.ndarray]:
    import laspy
    from pyproj import Transformer
    dtype = POINT_DTYPE
    consistent_sources(job['sources'])
    from shapely.geometry import box
    from shapely import STRtree
    buildings = job['buildings']
    result = {b['buildingId']:[] for b in buildings}
    largest_buffer = max((s['supportBufferM'] for s in job['sources'] if s['kind']=='lidar'),default=50)
    support_index = STRtree([box(*b['bbox']).buffer(largest_buffer,cap_style='square',join_style='mitre') for b in buildings])
    # Stable source order, independent of acquisition completion or lock ordering.
    sources = sorted((s for s in job['sources'] if s['kind']=='lidar'),key=lambda s:(s['sha256'],s['path']))
    seen = set()
    for source in sources:
        sha = source['sha256']
        if sha in seen:
            continue
        seen.add(sha)
        path = Path(source['path'])
        metadata = job.get('_verifiedSources',{}).get(sha)
        if metadata is None:
            with path.open('rb') as handle:
                actual = hashlib.file_digest(handle,'sha256').hexdigest()
            if actual != sha:
                raise ValueError('sha256 mismatch: '+str(path))
            with laspy.open(path) as reader:
                w,s = reader.header.mins[:2]; e,n = reader.header.maxs[:2]
            if source['horizontalCrs'] != 'EPSG:7131':
                w,s,e,n = Transformer.from_crs(source['horizontalCrs'],'EPSG:7131',always_xy=True).transform_bounds(w,s,e,n,densify_pts=21)
            metadata = [w,s,e,n]
        shortlist = support_index.query(box(*metadata))
        if not len(shortlist):
            continue
        a = decode_source(source)
        x,y = a['x'],a['y']
        # Parent EPT nodes contain incidental points outside selected coverage. Keep
        # only the committed coverage plus its ground support before per-building crops.
        coverage_mask = np.ones(len(a),dtype=bool)
        if 'coverage' in source:
            coverage_mask[:] = False
            transformer = Transformer.from_crs('EPSG:4326','EPSG:7131',always_xy=True)
            for coverage in source['coverage']:
                cw,cs,ce,cn = transformer.transform_bounds(*coverage['bbox'],densify_pts=21)
                support = source['supportBufferM']
                coverage_mask |= (x>=cw-support)&(x<=ce+support)&(y>=cs-support)&(y<=cn+support)
        for index in shortlist:
            building = buildings[int(index)]
            w,s,e,n = building['bbox']
            buffer = source['supportBufferM']
            if buffer < 50:
                raise ValueError('insufficient ground support buffer')
            mask = coverage_mask&(x>=w-buffer)&(x<=e+buffer)&(y>=s-buffer)&(y<=n+buffer)
            if mask.any():
                result[building['buildingId']].append(a[mask])
    return {key:np.concatenate(arrays) if arrays else np.empty(0,dtype=dtype) for key,arrays in result.items()}


if __name__ == '__main__':
    # Batch canonicalization keeps one Python invocation per input job.
    geometries = json.load(sys.stdin)
    json.dump([{'footprint':canonical_geometry(g),'footprintHash':footprint_hash(g)} for g in geometries],sys.stdout,separators=(',',':'),allow_nan=False)
