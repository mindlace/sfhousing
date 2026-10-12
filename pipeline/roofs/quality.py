"""Conservative geometry checks and held-out selection diagnostics."""
from collections import Counter, defaultdict
import numpy as np
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union
from shapely import contains_xy


def fallback(building, reason, candidates=None):
    return {'buildingId':building['buildingId'],'footprintHash':building['footprintHash'],
            'method':'footprint','mesh':None,'selectedCandidate':None,'reason':reason,
            'flags':[],'candidates':candidates or [],'ground':None,'archives':[],
            'followUp':{'revisit':reason is not None,'reasons':[reason] if reason else []}}


def mesh_metrics(mesh, building, landmark=False):
    result = {'reason':None,'roofCoverage':None,'maxHeightM':None,'triangleCount':0,
              'roofSections':0,'pitchedFraction':None,'spikes':0,'negativeCorrectionM':None}
    try:
        v = np.array(mesh['vertices'],dtype=float)
        t = np.array(mesh['triangles'])
        if v.ndim != 2 or v.shape[1] != 3 or t.ndim != 2 or t.shape[1] != 3 or not np.issubdtype(t.dtype,np.integer) or not len(t) or not np.isfinite(v).all() or t.min() < 0 or t.max() >= len(v):
            raise ValueError('invalid mesh arrays')
        result['triangleCount'] = len(t)
        result['negativeCorrectionM'] = float(max(0,-v[:,2].min()))
        if v[:,2].min() < -.1:
            raise ValueError('below measured ground')
        v[:,2] = np.maximum(0,v[:,2])
        abc = v[t]
        normals = np.cross(abc[:,1]-abc[:,0],abc[:,2]-abc[:,0])
        if (np.linalg.norm(normals,axis=1) <= 1e-10).any():
            raise ValueError('zero area triangle')
        edges = Counter((int(a),int(b)) for tri in t for a,b in zip(tri,np.roll(tri,-1)))
        if any(count != 1 or edges[(b,a)] != 1 for (a,b),count in edges.items()):
            raise ValueError('mesh is not a closed oriented manifold')
        # Translation stabilizes the signed volume calculation for projected coordinates.
        local = abc-v[0]
        if np.einsum('ij,ij->i',local[:,0],np.cross(local[:,1],local[:,2])).sum()/6 <= 0:
            raise ValueError('inward or empty mesh')
        semantics = mesh['semantics']
        if len(semantics) != len(t):
            raise ValueError('missing semantics')
        roof = np.array([s == 'RoofSurface' for s in semantics])
        if not roof.any() or (normals[roof,2] <= 0).any():
            raise ValueError('invalid roof semantics/normals')
        roof_ids = np.flatnonzero(roof)
        polygons = [Polygon(abc[i,:,:2]) for i in roof_ids]
        footprint = shape(building['footprint'])
        projected = unary_union(polygons)
        coverage = projected.intersection(footprint).area/footprint.area
        # A filled courtyard is a geometry error even when footprint coverage is high.
        if projected.difference(footprint.buffer(.001)).area > max(.01,footprint.area*.001):
            raise ValueError('roof fills footprint holes or exceeds outline')
        result['roofCoverage'] = float(coverage)
        result['maxHeightM'] = float(v[:,2].max())
        areas = normals[roof,2]/2
        slopes = np.degrees(np.arctan2(np.linalg.norm(normals[roof,:2],axis=1),normals[roof,2]))
        result['pitchedFraction'] = float(areas[slopes > 8].sum()/areas.sum())
        # Merge roof triangles sharing a plane into patches before looking for caps.
        patches = defaultdict(list)
        supplied = mesh.get('roofPatchIds')
        for i, poly in zip(roof_ids,polygons):
            normal = normals[i]/np.linalg.norm(normals[i])
            plane = tuple(np.round(np.r_[normal, np.dot(normal,v[t[i,0]]-v[0])],5))
            key = supplied[i] if supplied else plane
            patches[str(key)].append((poly,float(abc[i,:,2].max())))
        patches = [(unary_union([p for p,z in group]),max(z for p,z in group)) for group in patches.values()]
        result['roofSections'] = len(patches)
        threshold = max(.25,.005*footprint.area)
        result['spikes'] = sum(1 for p,z in patches if p.area < threshold and any(q.area > p.area and p.boundary.distance(q.boundary) <= .1+1e-9 and z-w > 2 for q,w in patches if q is not p))
        if coverage < .98: result['reason'] = 'roof_coverage_low'
        elif len(t) > (16384 if landmark else 512): result['reason'] = 'complexity_limit'
        elif not 2.5 <= result['maxHeightM'] <= 340: result['reason'] = 'source_height_disagreement'
        elif not landmark and abs(result['maxHeightM']-building['heightM']) > max(5,.5*building['heightM']): result['reason'] = 'source_height_disagreement'
        mesh['vertices'] = v.tolist()
    except (ValueError,KeyError,TypeError,IndexError):
        result['reason'] = 'invalid_geometry'
    return result


def validation_samples(points, building):
    footprint = shape(building['footprint']).buffer(-.5)
    if not len(points) or footprint.is_empty:
        return points[:0]
    points = points[contains_xy(footprint,points['x'],points['y'])]
    if not len(points): return points
    keys = np.floor(np.column_stack([points['x'],points['y']])/.5).astype(np.int64)
    maxima = {}
    for key,z in zip(map(tuple,keys),points['z']): maxima[key] = max(maxima.get(key,-np.inf),z)
    keep = np.array([z >= maxima[tuple(key)]-.05 for key,z in zip(keys,points['z'])])
    points = points[keep]
    return np.sort(points,order=['sourceSha','ordinal'])[:5000]


def validation_metrics(mesh, points):
    if not len(points): return {'maeM':None,'validationSamples':0,'validationCoverage':None}
    v = np.asarray(mesh['vertices'])
    z = np.full(len(points),-np.inf)
    xy = np.column_stack([points['x'],points['y']])
    for tri,semantic in zip(mesh['triangles'],mesh['semantics']):
        if semantic != 'RoofSurface': continue
        abc = v[tri]
        matrix = np.column_stack([abc[1,:2]-abc[0,:2],abc[2,:2]-abc[0,:2]])
        if abs(np.linalg.det(matrix)) < 1e-12: continue
        uv = np.linalg.solve(matrix,(xy-abc[0,:2]).T).T
        inside = (uv[:,0] >= -1e-8)&(uv[:,1] >= -1e-8)&(uv.sum(axis=1) <= 1+1e-8)
        heights = abc[0,2]+uv[:,0]*(abc[1,2]-abc[0,2])+uv[:,1]*(abc[2,2]-abc[0,2])
        z[inside] = np.maximum(z[inside],heights[inside])
    covered = np.isfinite(z)
    return {'maeM':float(np.abs(z[covered]-points['z'][covered]).mean()) if covered.any() else None,
            'validationSamples':len(points),'validationCoverage':float(covered.mean())}


def choose_candidates(candidates, building):
    by_name = {c['name']:c for c in candidates}
    valid = [c for c in candidates if c['metrics']['reason'] is None and not c['metrics']['spikes']]
    simple = by_name.get('simplified')
    retry = by_name.get('retry')
    spike = next((by_name[name] for name in ['simplified','reference'] if name in by_name and by_name[name]['metrics']['spikes']),None)
    if spike and retry in valid:
        if retry['metrics']['maeM'] is None or spike['metrics']['maeM'] is None or retry['metrics']['maeM']-spike['metrics']['maeM'] > .05+1e-12:
            valid.remove(retry)
    selected = next((c for name in ['simplified','retry','reference','landmark'] for c in valid if c['name']==name),None)
    reference = by_name.get('reference')
    if selected and reference in valid and reference['metrics']['pitchedFraction'] > .35 and selected['metrics']['pitchedFraction'] <= .35 and selected['metrics']['maeM']-reference['metrics']['maeM'] > .25:
        selected = reference
    if selected is None:
        reason = 'spike_unresolved' if any(c['metrics']['spikes'] for c in candidates) else next((c['metrics']['reason'] for c in candidates if c['metrics']['reason']), 'fit_failed')
        return fallback(building,reason,candidates)
    result = fallback(building,None,candidates)
    result.update(method='lidar_only',mesh=selected['mesh'],selectedCandidate=selected['name'])
    return result


def select_candidate(candidates, validation_points, building, config):
    samples = validation_samples(validation_points,building)
    for c in candidates:
        metrics = mesh_metrics(c['mesh'],building,c['name']=='landmark') if c.get('mesh') else {'reason':'fit_failed','spikes':0}
        metrics.update(validation_metrics(c['mesh'],samples) if c.get('mesh') and metrics['reason'] != 'invalid_geometry' else {'maeM':None,'validationSamples':len(samples),'validationCoverage':None})
        if metrics['reason'] is None and c['name'] != 'landmark':
            if c.get('trainingCount',0) < 50: metrics['reason'] = 'lidar_sparse'
            elif len(samples) < 20 or metrics['validationCoverage'] is None or metrics['validationCoverage'] < .95: metrics['reason'] = 'validation_insufficient'
        c['metrics'] = metrics
    return choose_candidates(candidates,building)
