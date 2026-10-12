"""Pinned roofer 1.0.0 adapter. Supplied ground is mandatory."""
import json
import math
from pathlib import Path
import subprocess
import numpy as np
import laspy
from pyproj import CRS
from shapely import constrained_delaunay_triangles
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[2]
ROOFER = ROOT/'pipeline/.cache/tools/roofer/bin/roofer'


def decode_cityjson(feature, transform, ground):
    vertices = np.asarray(feature['vertices'],dtype=float)*transform['scale']+transform['translate']
    vertices[:,2] -= ground
    triangles, semantics, patches = [], [], []
    for obj in feature['CityObjects'].values():
        for geom in obj.get('geometry',[]):
            if geom.get('lod') != '2.2': continue
            if geom['type'] != 'Solid': raise ValueError('roofer returned non-solid')
            for si,shell in enumerate(geom['boundaries']):
                for fi,face in enumerate(shell):
                    # roofer may emit equivalent rings/faces in different orders.
                    canonical_rings = []
                    for ring in face:
                        start = min(range(len(ring)),key=lambda i:tuple(vertices[ring[i]]))
                        canonical_rings.append(ring[start:]+ring[:start])
                    face = [canonical_rings[0]]+sorted(canonical_rings[1:],key=lambda r:tuple(map(tuple,vertices[r])))
                    patch_key = tuple(tuple(map(tuple,vertices[r])) for r in face)
                    semantic = geom['semantics']['surfaces'][geom['semantics']['values'][si][fi]]['type']
                    rings = [vertices[ring] for ring in face]
                    normal = sum((np.cross(a,b) for a,b in zip(rings[0]-rings[0][0],np.roll(rings[0]-rings[0][0],-1,axis=0))),np.zeros(3))
                    axis = int(np.argmax(np.abs(normal)))
                    xy = [np.delete(r,axis,axis=1) for r in rings]
                    ids = np.concatenate(face)
                    flat = np.concatenate(xy)
                    lookup = {tuple(p):i for i,p in enumerate(flat)}
                    triangulated = constrained_delaunay_triangles(Polygon(xy[0],xy[1:]))
                    tris = np.array([[lookup[tuple(p)] for p in list(triangle.exterior.coords)[:3]] for triangle in triangulated.geoms],dtype=int)
                    for tri in tris:
                        tri = ids[tri]
                        actual = np.cross(vertices[tri[1]]-vertices[tri[0]],vertices[tri[2]]-vertices[tri[0]])
                        if np.dot(actual,normal) < 0: tri = tri[::-1]
                        triangles.append(tri.tolist()); semantics.append(semantic); patches.append(patch_key)
    # Roofer sometimes repeats exact boundary vertices. Weld only exact quantized output.
    unique, inverse = np.unique(vertices,axis=0,return_inverse=True)
    remapped = inverse[np.asarray(triangles)]
    normalized = []
    patch_ids = {key:i for i,key in enumerate(sorted(set(patches)))}
    for tri,semantic,key in zip(remapped,semantics,patches):
        start = int(np.argmin(tri))
        normalized.append((tuple(np.roll(tri,-start)),semantic,patch_ids[key]))
    normalized.sort()
    return {'vertices':unique.tolist(),'triangles':[list(map(int,t)) for t,s,p in normalized],
            'semantics':[s for t,s,p in normalized],'roofPatchIds':[p for t,s,p in normalized]}


def fit_one(building, training_points, ground, config, name, complexity, support):
    work = Path(config['workDir'])/building['buildingId']/name
    work.mkdir(parents=True,exist_ok=True)
    cloud = work/'training.laz'
    footprint = work/'footprint.geojson'
    output = work/'output'
    header = laspy.LasHeader(point_format=6,version='1.4')
    header.scales = np.full(3,.001)
    header.offsets = np.array([training_points['x'].min(),training_points['y'].min(),0])
    header.add_crs(CRS.from_epsg(7131))
    from datetime import date
    header.creation_date = date(2023,1,1)
    las = laspy.LasData(header)
    las.x,las.y,las.z = (training_points[k] for k in ('x','y','z'))
    las.classification = training_points['classification']
    las.write(cloud)
    footprint.write_text(json.dumps({'type':'FeatureCollection','features':[{'type':'Feature','geometry':building['footprint'],'properties':{'buildingId':building['buildingId'],'groundM':ground,'fallbackRoofZ':ground+building['heightM']}}]},allow_nan=False))
    args = [str(ROOFER),'--jobs','1','--bld-class','1','--grnd-class','2','--id-attribute','buildingId','--h-terrain-attribute','groundM','--h-terrain-strategy','user','--h-roof-attribute','fallbackRoofZ','--lod22','--no-clip-terrain','--complexity-factor',str(complexity),'--plane-detect-min-points',str(support),str(cloud),str(footprint),str(output)]
    try:
        run = subprocess.run(args,cwd=work,capture_output=True,text=True,timeout=180)
    except subprocess.TimeoutExpired:
        from types import SimpleNamespace
        run = SimpleNamespace(returncode=124,stdout='',stderr='isolated building fit timeout')
    (work/'roofer.log').write_text(run.stdout+run.stderr)
    candidate = {'name':name,'complexity':complexity,'planeSupport':support,'trainingCount':int((training_points['classification']==1).sum()),'mesh':None,'error':None}
    if run.returncode:
        candidate['error'] = 'roofer failed: '+str(run.returncode)
        return candidate
    files = sorted(output.glob('*.jsonl'))
    rows = [json.loads(line) for path in files for line in path.read_text().splitlines() if line.strip()]
    headers = [r for r in rows if r['type']=='CityJSON']
    features = [r for r in rows if r['type']=='CityJSONFeature' and r['id']==building['buildingId']]
    if len(headers) != 1 or len(features) != 1:
        candidate['error'] = 'roofer output missing building'
        return candidate
    obj = next(o for o in features[0]['CityObjects'].values() if o['type']=='Building')
    attributes = obj.get('attributes',{})
    candidate['rooferAttributes'] = {key:value for key,value in attributes.items() if key != 'rf_t_run'}
    if attributes.get('rf_success') is not True or attributes.get('rf_extrusion_mode') != 'standard' or attributes.get('rf_force_lod11'):
        candidate['error'] = 'roofer extrusion/unusable reconstruction'
        return candidate
    try:
        candidate['mesh'] = decode_cityjson(features[0],headers[0]['transform'],ground)
    except (ValueError,KeyError,IndexError,TypeError) as error:
        candidate['error'] = 'invalid roofer geometry: '+str(error)
    return candidate


def fit_candidates(building, training_points, ground, config):
    ground = ground.groundM if hasattr(ground,'groundM') else ground
    if ground is None or not math.isfinite(ground): raise ValueError('measured ground is required')
    if not ROOFER.is_file(): raise FileNotFoundError('required roofer executable unavailable')
    if not len(training_points): return []
    return [fit_one(building,training_points,ground,config,'simplified',.4,50),
            fit_one(building,training_points,ground,config,'reference',.888,15)]
