"""Offline bounded reconstruction orchestration; every input building has an outcome."""
import argparse
import hashlib
import gzip
import io
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import numpy as np
from PIL import Image, UnidentifiedImageError
from pyproj import Transformer
from shapely.geometry import shape, box
from shapely.ops import unary_union
from shapely import transform
from shapely import contains_xy, STRtree
from geometry import load_points
from filter import validation_partition, estimate_ground, vegetation_mask, apply_cells
from fit import fit_candidates, fit_one, ROOFER
from quality import fallback, select_candidate

ROOT = Path(__file__).resolve().parents[2]


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()


class Archive:
    def __init__(self, directory):
        self.directory = Path(directory); self.directory.mkdir(parents=True,exist_ok=True)
        self.files = {}

    def save(self, data, name):
        sha = hashlib.sha256(data).hexdigest()
        ext = Path(name).suffix
        record = {'url':'','sha256':sha,'bytes':len(data),'archiveKey':f'roof-processing/{sha}{ext}','name':name}
        (self.directory/sha).write_bytes(data)
        self.files[record['archiveKey']] = record
        return record

    def json(self, value, name): return self.save(canonical(value),name)

    def array(self, value, name):
        stream = io.BytesIO(); np.save(stream,value,allow_pickle=False)
        # Stable mtime avoids wall-clock-dependent gzip bytes; structured identities compress well.
        return self.save(gzip.compress(stream.getvalue(),mtime=0),name+'.gz')


def source_coverage(job):
    bounds = [c['bbox'] for entry in job['sourceStatus'] if entry['sourceId']=='roof-lidar' for c in entry['spatial']['coverage']]
    tx = Transformer.from_crs('EPSG:4326','EPSG:7131',always_xy=True)
    return unary_union([transform(box(*b),tx.transform,interleaved=False) for b in bounds])


def validate_aerials(job):
    images = []
    for source in job['sources']:
        if source['kind'] != 'aerial': continue
        path = Path(source['path'])
        if hashlib.sha256(path.read_bytes()).hexdigest() != source['sha256']:
            raise ValueError('aerial locked sha256 mismatch')
        try:
            with Image.open(path) as image:
                if image.format not in ('PNG','JPEG'): raise ValueError('unsupported aerial image format')
                image.load()
                tiles = source.get('tiles',[])
                matches = [t for t in tiles if source['name'].endswith(f"/{t.get('x')}/{t.get('y')}.png")]
                if len(matches) != 1 and len(tiles)==1: matches = tiles
                if len(matches) != 1: raise ValueError('aerial raster transform missing')
                tile = matches[0]
                if image.size != (tile['width'],tile['height']): raise ValueError('aerial dimensions disagree with raster transform')
                if len(tile['transform']) != 6 or not np.isfinite(tile['transform']).all(): raise ValueError('invalid aerial raster transform')
                images.append((source,path,tile))
        except (UnidentifiedImageError,OSError) as error:
            raise ValueError('corrupt aerial image') from error
    return images


def building_mask(training, images, config):
    rejected = np.zeros(len(training),dtype=bool); cells = []; flags = []; diagnostics = []; used = False
    for source,image,tile in images:
        if source['permission'] != 'confirmed':
            flags.append('aerial_rights_unconfirmed'); continue
        if source['alignment'] != 'verified':
            flags.append('aerial_alignment_uncertain'); continue
        # Load validated raster bytes only for intersecting building support.
        if isinstance(image,Path):
            tx = tile['transform']
            xmin,xmax = sorted([tx[2],tx[2]+tile['width']*tx[0]])
            ymin,ymax = sorted([tx[5],tx[5]+tile['height']*tx[4]])
            bounds = Transformer.from_crs(source['horizontalCrs'],'EPSG:7131',always_xy=True).transform_bounds(xmin,ymin,xmax,ymax,densify_pts=21)
            if not len(training) or not box(*bounds).intersects(box(float(training['x'].min()),float(training['y'].min()),float(training['x'].max()),float(training['y'].max()))): continue
            with Image.open(image) as raster: image = np.array(raster.convert('RGB'))
        # Mercator scale is sec(latitude); convert raster pixels to physical metres.
        tx = tile['transform']
        latitude = np.degrees(np.arctan(np.sinh((tx[5]+tile['height']*tx[4]/2)/6378137)))
        pixel = abs(tx[0])*np.cos(np.radians(latitude))
        used = True
        result = vegetation_mask(training,image,{'transform':tx,'crs':source['horizontalCrs'],'groundPixelM':pixel},config)
        rejected |= result.rejected; cells.extend(result.cells.tolist()); flags.extend(result.flags); diagnostics.extend(result.diagnostics)
    if not images: flags.append('aerial_missing')
    return rejected,np.unique(np.array(cells,dtype=np.int64).reshape(-1,2),axis=0),flags,sorted(set(diagnostics)),used


def landmark_override(building):
    record = json.loads((ROOT/'pipeline/roofs/overrides/salesforce.json').read_text())
    if building['buildingId'] != record['buildingId']: return None
    if building['footprintHash'] != record['footprintHash']:
        return fallback(building,'override_stale')
    from quality import mesh_metrics
    candidate = {'name':'landmark','mesh':record['mesh'],'metrics':mesh_metrics(record['mesh'],building,True)}
    candidate['metrics'].update(maeM=None,validationSamples=0,validationCoverage=None)
    from quality import choose_candidates
    result = choose_candidates([candidate],building)
    if result['mesh'] is not None: result['method'] = 'landmark'
    result['ground'] = {'groundM':record['parameters']['ground'],'method':'landmark_authoring_reference','count':record['authoringMetrics']['heldout_points']}
    result['override'] = {key:record[key] for key in ['overrideVersion','authoringMethod','measuredRelativeRangeM','approximateRelativeRangesM','limitations','productionConversion','productionValidation']}
    return result


def process_building(building, points, images, config):
    landmark = landmark_override(building)
    if landmark is not None:
        landmark['usedSources']=['roof-lidar'] if landmark.get('override') else []
        return landmark, {}
    footprint = shape(building['footprint'])
    points = points[~np.isin(points['classification'],[7,18])]
    ground = estimate_ground(points,footprint)
    if ground.groundM is None:
        result=fallback(building,'ground_missing')
        result['usedSources']=['roof-lidar']
        return result, {'ground':ground._asdict()}
    validation = np.zeros(len(points),dtype=bool)
    for sha in np.unique(points['sourceSha']):
        ids = points['sourceSha']==sha
        validation[ids] = validation_partition(str(sha),points['ordinal'][ids])
    inside = contains_xy(footprint,points['x'],points['y'])
    train = points[~validation & ((inside & (points['classification']==1)) | (points['classification']==2))]
    rejected,cells,flags,diagnostics,aerial_used = building_mask(train,images,config)
    retained = train[~rejected]
    held = points[validation & inside & (points['classification']==1)]
    held = held[~apply_cells(held,cells,config['cellM'])].copy()
    held['z'] -= ground.groundM
    count = int((retained['classification']==1).sum())
    if count < 50:
        result = fallback(building,'lidar_sparse')
    else:
        candidates = fit_candidates(building,retained,ground,config)
        result = select_candidate(candidates,held,building,config)
        if any(c['metrics']['spikes'] for c in candidates):
            retry = fit_one(building,retained,ground.groundM,config,'retry',.6,50)
            candidates.append(retry)
            result = select_candidate(candidates,held,building,config)
        if result['mesh'] is not None and len(cells): result['method'] = 'lidar_aerial'
    result['usedSources']=['roof-lidar']+(['roof-aerial'] if aerial_used else [])
    result['ground'] = ground._asdict()
    result['flags'] = sorted(set(flags))
    result['diagnostics'] = {'vegetation':diagnostics}
    result['returnCounts'] = {'before':len(train),'retained':len(retained),'rejected':int(rejected.sum()),'roofTraining':count,'validation':len(held)}
    return result, {'training':retained,'validation':held,'mask':rejected,'canopyCells':cells,'vegetationDiagnostics':diagnostics}


def process_job(job):
    if job['schemaVersion'] != 1: raise ValueError('unsupported roof job')
    if not ROOFER.is_file(): raise FileNotFoundError('required roofer unavailable')
    ids = [b['buildingId'] for b in job['buildings']]
    if len(set(ids)) != len(ids): raise ValueError('duplicate input building ids')
    config = json.loads(Path(job['configPath']).read_text())
    config['workDir'] = job['workDir']
    images = validate_aerials(job)
    # Verify every locked input once, including nodes outside the selected buildings.
    import laspy
    verified = {}
    for source in job['sources']:
        if source['kind'] != 'lidar' or source['sha256'] in verified: continue
        path = Path(source['path'])
        with path.open('rb') as handle:
            if hashlib.file_digest(handle,'sha256').hexdigest() != source['sha256']:
                raise ValueError('LiDAR locked sha256 mismatch')
        with laspy.open(path) as reader:
            w,s = reader.header.mins[:2]; e,n = reader.header.maxs[:2]
        if source['horizontalCrs'] != 'EPSG:7131':
            w,s,e,n = Transformer.from_crs(source['horizontalCrs'],'EPSG:7131',always_xy=True).transform_bounds(w,s,e,n,densify_pts=21)
        verified[source['sha256']] = [w,s,e,n]
    job = dict(job,_verifiedSources=verified)
    node_sources = sorted((s for s in job['sources'] if s['kind']=='lidar'),key=lambda s:(s['sha256'],s['name']))
    node_index = STRtree([box(*verified[s['sha256']]) for s in node_sources])
    support = max((s['supportBufferM'] for s in node_sources),default=50)
    archive = Archive(Path(job['workDir'])/'artifacts')
    config_ref = archive.save(Path(job['configPath']).read_bytes(),'config.json')
    dependency_refs = [archive.save((ROOT/'pipeline/roofs'/name).read_bytes(),name) for name in ['toolchain.json','requirements.txt','config.json','source-config.json','job.ts','inputs.ts','run.ts','setup.ts','types.py','geometry.py','filter.py','fit.py','quality.py','process.py','overrides/salesforce.json']]
    source_refs = archive.json({'sources':[{k:v for k,v in s.items() if k!='path'} for s in job['sources']],'sourceStatus':job['sourceStatus'],'sourceArchives':job.get('sourceArchives',[])},'sources.json')
    coverage = source_coverage(job)
    eligible = [b for b in job['buildings'] if coverage.covers(shape(b['footprint']))]
    results = {}
    for building in job['buildings']:
        if not coverage.covers(shape(building['footprint'])):
            results[building['buildingId']] = fallback(building,'not_in_coverage')
    # Bounded spatial batches keep per-building support-cloud duplication bounded.
    eligible.sort(key=lambda b:(int(b['bbox'][0]//1000),int(b['bbox'][1]//1000),b['buildingId']))
    for offset in range(0,len(eligible),4):
        batch = eligible[offset:offset+4]
        node_ids = sorted(set(int(i) for b in batch for i in node_index.query(box(*b['bbox']).buffer(support,cap_style='square',join_style='mitre'))))
        clouds = load_points(dict(job,buildings=batch,sources=[node_sources[i] for i in node_ids]))
        for building in batch:
            points = clouds[building['buildingId']]
            if not len(points):
                result, evidence = fallback(building,'lidar_missing'), {}
            else:
                result,evidence = process_building(building,points,images,config)
            result['archives'] = [archive.array(points,building['buildingId']+'-points.npy')]
            for name,value in evidence.items():
                result['archives'].append(archive.array(value,building['buildingId']+'-'+name+'.npy') if isinstance(value,np.ndarray) else archive.json(value,building['buildingId']+'-'+name+'.json'))
            for candidate in result['candidates']:
                # Scratch commands are diagnostics, not portable dependencies.
                candidate.pop('command',None)
                result['archives'].append(archive.json(candidate,building['buildingId']+'-'+candidate['name']+'.json'))
            results[building['buildingId']] = result
    for building in job['buildings']:
        result = results[building['buildingId']]
        result.setdefault('usedSources',[])
        aerial_flags = []
        for entry in job['sourceStatus']:
            if entry['sourceId'] != 'roof-aerial': continue
            spatial = entry['spatial']
            if spatial['permission'] != 'confirmed': aerial_flags.append('aerial_rights_unconfirmed')
            if spatial['alignment'] != 'verified': aerial_flags.append('aerial_alignment_uncertain')
            if spatial.get('status') in ('disabled','unavailable'): aerial_flags.append('aerial_missing')
        result['flags'] = sorted(set(result['flags']+aerial_flags))
        input_ref = archive.json({'schemaVersion':1,'datasetVersion':job['datasetVersion'],'building':building,'sources':source_refs,'config':config_ref,'dependencies':dependency_refs,'toolchainHash':job['toolchainHash'],'extracts':result['archives']},building['buildingId']+'-input.json')
        result['archives'].extend([input_ref,config_ref,source_refs,*dependency_refs])
    return {'buildings':[results[i] for i in ids],'archives':sorted(archive.files.values(),key=lambda r:r['archiveKey'])}


def write_records(path, groups):
    """No city-sized result string; one building/piece/archive descriptor per line."""
    counts = {}
    with Path(path).open('wb') as output:
        for kind, values in groups.items():
            count = 0
            for value in values:
                output.write(canonical({'type':kind,'value':value})+b'\n')
                count += 1
            counts[kind+'Count'] = count
        output.write(canonical({'type':'end',**counts})+b'\n')


def read_clip_records(path):
    groups = {'building':[],'piece':[]}; ended = False
    with Path(path).open() as source:
        for line in source:
            if ended: raise ValueError('roof record after terminal counts')
            record = json.loads(line)
            if record['type'] == 'end':
                if any(record[k+'Count'] != len(v) for k,v in groups.items()): raise ValueError('roof terminal counts mismatch')
                ended = True
            elif record['type'] in groups: groups[record['type']].append(record['value'])
            else: raise ValueError('unknown roof record')
    if not ended: raise ValueError('incomplete roof records')
    return {'buildings':groups['building'],'pieces':groups['piece'],'workDir':str(Path(path).resolve().parent)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--job'); mode.add_argument('--clip-job')
    parser.add_argument('--result-format',choices=['json','ndjson'],default='json')
    args = parser.parse_args()
    job = read_clip_records(args.clip_job) if args.clip_job and args.clip_job.endswith('.ndjson') else json.loads(Path(args.job or args.clip_job).read_text())
    if args.clip_job:
        from clip import clip_building
        from geometry import make_piece_id
        by_id = {b['buildingId']:b for b in job['buildings']}
        pieces = {}
        for p in job['pieces']: pieces.setdefault(p['buildingId'],[]).append(p)
        result = []
        for bid in sorted(pieces):
            b = by_id[bid]
            if b['mesh'] is None:
                result.extend(dict(p,pieceId=make_piece_id(bid,p['parcelId'],p['geometry']),mesh=None,reason=b['reason']) for p in pieces[bid])
            else: result.extend(clip_building(b['mesh'],pieces[bid]))
        result.sort(key=lambda p:p['pieceId'])
    else:
        result = process_job(job)
    output = Path(job['workDir'])/('result.ndjson' if args.result_format=='ndjson' else 'result.json')
    if args.result_format=='ndjson':
        write_records(output,{'piece':result} if args.clip_job else {'building':result['buildings'],'archive':result['archives']})
    else:
        output.write_bytes(canonical(result))
    print(str(output))
