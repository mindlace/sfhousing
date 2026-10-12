"""Versioned private point evidence; original LAZ remains the reconstruction source."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import zlib
import numpy as np
from geometry import POINT_DTYPE, decode_source, consistent_sources

RECORD_DTYPE = np.dtype([('sourceIndex','<u4'),('ordinal','<u8')])
LOGICAL_DTYPE = np.dtype([('x','<f8'),('y','<f8'),('z','<f8'),('classification','u1'),('sourceSha','S64'),('ordinal','<u8')])
RECORD_ENCODING = 'npy-gzip-source-u32-ordinal-u64-le-v1'
COORDINATE_RECIPE = 'laspy-scaled-xy-to-epsg7131-z-unchanged-v1'
ORDER = 'source-sha-ordinal-v1'
# Bounded tools must explicitly raise this limit for larger evidence.
DEFAULT_MAX_BYTES = 2 * 1024**3
SHA = re.compile(r'[0-9a-f]{64}\Z')


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()


class Archive:
    def __init__(self, directory):
        self.directory = Path(directory); self.directory.mkdir(parents=True,exist_ok=True)
        self.files = {}

    def _write(self, name, emit):
        digest = hashlib.sha256(); size = 0
        with tempfile.NamedTemporaryFile(dir=self.directory,suffix='.part',delete=False) as output:
            part = Path(output.name)
            class Sink:
                def write(self, data):
                    nonlocal size
                    n = output.write(data); digest.update(data); size += n
                    return n
                def flush(self): output.flush()
            try:
                emit(Sink()); output.flush()
                sha = digest.hexdigest()
                record = {'url':'','sha256':sha,'bytes':size,'archiveKey':f'roof-processing/{sha}{Path(name).suffix}','name':name}
                os.replace(part,self.directory/sha)
            finally:
                part.unlink(missing_ok=True)
        self.files[record['archiveKey']] = record
        return record

    def save(self, data, name): return self._write(name,lambda sink:sink.write(data))
    def json(self, value, name): return self.save(canonical(value),name)

    def array(self, value, name, chunk_bytes=1024*1024):
        value = np.ascontiguousarray(value)
        if value.dtype.hasobject or chunk_bytes < 1: raise ValueError('invalid array encoding')
        def emit(sink):
            with gzip.GzipFile(filename='',mode='wb',fileobj=sink,compresslevel=9,mtime=0) as stream:
                np.lib.format.write_array_header_1_0(stream,{'descr':np.lib.format.dtype_to_descr(value.dtype),'fortran_order':False,'shape':value.shape})
                if not value.size: return
                data = memoryview(value).cast('B')
                for start in range(0,len(data),chunk_bytes): stream.write(data[start:start+chunk_bytes])
        return self._write(name+'.gz',emit)


def verified_path(ref, directory, prefix='roof-processing'):
    if (not isinstance(ref,dict) or not isinstance(ref.get('sha256'),str) or not SHA.fullmatch(ref['sha256'])
        or type(ref.get('bytes')) is not int or ref['bytes'] < 0
        or not re.fullmatch(prefix+'/'+ref['sha256']+r'\.[a-z0-9]+',ref.get('archiveKey',''))):
        raise ValueError('invalid archive descriptor')
    path = Path(directory)/ref['sha256']
    if not path.is_file() or path.stat().st_size != ref['bytes']: raise ValueError('archive missing or length mismatch')
    with path.open('rb') as stream:
        if hashlib.file_digest(stream,'sha256').hexdigest() != ref['sha256']: raise ValueError('archive hash mismatch')
    return path


def read_json(ref, directory):
    path = verified_path(ref,directory)
    if path.stat().st_size > 32*1024**2: raise ValueError('descriptor too large')
    def pairs(items):
        result = {}
        for key,value in items:
            if key in result: raise ValueError('duplicate JSON key')
            result[key] = value
        return result
    return json.loads(path.read_text(),object_pairs_hook=pairs,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON')))


def read_array(ref, directory, dtype, count=None, max_bytes=DEFAULT_MAX_BYTES, ndim=1):
    """One gzip member, bounded inflation, checked NPY header/count before allocation."""
    path = verified_path(ref,directory)
    if count is not None and (type(count) is not int or count < 0 or count*np.dtype(dtype).itemsize > max_bytes):
        raise ValueError('invalid array count or allocation bound')
    try:
        with tempfile.TemporaryFile() as unpacked, path.open('rb') as source:
            decoder = zlib.decompressobj(31); size = 0
            while chunk := source.read(1024*1024):
                if decoder.eof: raise ValueError('trailing gzip data/member')
                while chunk:
                    data = decoder.decompress(chunk,1024*1024)
                    size += len(data)
                    if size > max_bytes+65536: raise ValueError('array allocation bound exceeded')
                    unpacked.write(data)
                    if decoder.unused_data: raise ValueError('trailing gzip data/member')
                    chunk = decoder.unconsumed_tail
            if not decoder.eof: raise ValueError('truncated gzip')
            unpacked.seek(0)
            version = np.lib.format.read_magic(unpacked)
            if version == (1,0): shape,fortran,found = np.lib.format.read_array_header_1_0(unpacked)
            elif version == (2,0): shape,fortran,found = np.lib.format.read_array_header_2_0(unpacked)
            else: raise ValueError('unsupported NPY version')
            if found != np.dtype(dtype) or found.hasobject or fortran or len(shape) != ndim:
                raise ValueError('invalid array dtype or shape')
            length = int(np.prod(shape,dtype=object))
            if length*found.itemsize > max_bytes or (count is not None and shape[0] != count):
                raise ValueError('array count or allocation bound mismatch')
            if size-unpacked.tell() != length*found.itemsize: raise ValueError('array length/count mismatch')
            return np.fromfile(unpacked,dtype=found,count=length).reshape(shape)
    except (OSError,EOFError,zlib.error) as error:
        raise ValueError('corrupt array body') from error


def validate_points(points):
    if points.ndim != 1 or points.dtype != POINT_DTYPE: raise ValueError('invalid expanded point dtype')
    if not all(np.isfinite(points[k]).all() for k in ('x','y','z')): raise ValueError('nonfinite point')
    shas = np.unique(points['sourceSha']).tolist()
    if any(not SHA.fullmatch(s) for s in shas): raise ValueError('invalid source SHA')
    if len(points)>1:
        a,b=points[:-1],points[1:]
        if np.any((a['sourceSha']>b['sourceSha'])|((a['sourceSha']==b['sourceSha'])&(a['ordinal']>=b['ordinal']))):
            raise ValueError('duplicate or out-of-order point identity')


def logical_digest(points):
    validate_points(points)
    digest=hashlib.sha256()
    for start in range(0,len(points),8192):
        chunk=points[start:start+8192]; packed=np.empty(len(chunk),dtype=LOGICAL_DTYPE)
        for name in packed.dtype.names: packed[name]=chunk[name]
        digest.update(packed.tobytes())
    return digest.hexdigest()


def validate_records(records, shas, count):
    if (not isinstance(shas,list) or len(shas)>2**32 or any(not isinstance(s,str) or not SHA.fullmatch(s) for s in shas)
        or shas != sorted(set(shas))): raise ValueError('invalid source dictionary')
    if type(count) is not int or count < 0 or records.ndim != 1 or records.dtype != RECORD_DTYPE or len(records)!=count:
        raise ValueError('invalid record count/dtype')
    if len(records) and (not shas or int(records['sourceIndex'].max())>=len(shas)): raise ValueError('source index out of range')
    if len(records)>1:
        a,b=records[:-1],records[1:]
        if np.any((a['sourceIndex']>b['sourceIndex'])|((a['sourceIndex']==b['sourceIndex'])&(a['ordinal']>=b['ordinal']))):
            raise ValueError('duplicate or out-of-order identity')


def source_dictionary(source_descriptor, shas):
    by_sha=consistent_sources(source_descriptor['sources'])
    raw={}
    for child in source_descriptor['sourceArchives']:
        sha=child.get('sha256')
        if (not isinstance(sha,str) or not SHA.fullmatch(sha) or type(child.get('bytes')) is not int or child['bytes']<0
            or not re.fullmatch('sources/'+sha+r'\.[a-z0-9]+',child.get('archiveKey',''))):raise ValueError('invalid raw source descriptor')
        if sha in raw and (raw[sha]['bytes']!=child['bytes'] or raw[sha]['archiveKey']!=child['archiveKey']):raise ValueError('conflicting raw source')
        raw[sha]=child
    for status in source_descriptor.get('sourceStatus',[]):
        for item in status['spatial'].get('objects',[]):
            if item['sha256'] not in raw:raise ValueError('missing raw source metadata/hierarchy closure')
    for sha in shas:
        if sha not in by_sha or sha not in raw or raw[sha]['archiveKey']!=f'sources/{sha}.laz':raise ValueError('missing source metadata/raw object')
        source=by_sha[sha]
        if (source['horizontalCrs'] not in ('EPSG:7131','EPSG:3857') or any(source.get(k)!='m' for k in ('horizontalUnits','verticalUnits'))
            or not isinstance(source.get('supportBufferM'),(int,float)) or not np.isfinite(source['supportBufferM']) or source['supportBufferM']<50):raise ValueError('unsupported source CRS/units/support')
    return by_sha,raw


def write_points(archive, points, building_id, sources):
    digest=logical_digest(points)
    shas=np.unique(points['sourceSha']).tolist()
    if len(shas)>2**32: raise ValueError('source dictionary overflow')
    source_dictionary(read_json(sources,archive.directory),shas)
    records=np.empty(len(points),dtype=RECORD_DTYPE)
    records['sourceIndex']=np.searchsorted(shas,points['sourceSha']); records['ordinal']=points['ordinal']
    validate_records(records,shas,len(points))
    child=archive.array(records,building_id+'-point-records.npy')
    ref=archive.json({'kind':'roof-point-references','schemaVersion':1,'count':len(points),'sources':sources,'sourceShas':shas,'records':child,'recordEncoding':RECORD_ENCODING,'coordinateRecipe':COORDINATE_RECIPE,'order':ORDER,'logicalSha256':digest},building_id+'-points.refs.json')
    return ref,[child]


def validate_rows(rows, count):
    if rows.ndim!=1 or rows.dtype!=np.dtype('<u8') or (len(rows) and (int(rows[-1])>=count or np.any(rows[1:]<=rows[:-1]))):
        raise ValueError('invalid subset rows')


def subset_arrays(points, pre, validation, mask, ground):
    validate_rows(pre,len(points));validate_rows(validation,len(points))
    if np.intersect1d(pre,validation).size: raise ValueError('overlapping subset rows')
    if mask.dtype!=np.dtype(bool) or mask.shape!=(len(pre),): raise ValueError('mask domain mismatch')
    if np.any(mask & (points['classification'][pre]==2)): raise ValueError('mask rejects ground')
    if not np.isfinite(ground): raise ValueError('nonfinite ground')
    held=points[validation].copy();held['z'] -= ground
    training=points[pre[~mask]]
    return training,held


def write_subsets(archive, point_ref, points, pre, validation, mask, mask_ref, ground_m, building_id):
    training,held=subset_arrays(points,pre,validation,mask,ground_m)
    children=[archive.array(pre,building_id+'-preTrainingRows.npy'),archive.array(validation,building_id+'-validationRows.npy')]
    ref=archive.json({'kind':'roof-point-subsets','schemaVersion':1,'points':point_ref,'mask':mask_ref,'preTrainingRows':children[0],'preTrainingCount':len(pre),'validationRows':children[1],'validationCount':len(validation),'rowEncoding':'npy-gzip-u64-le-v1','groundMHex':float(ground_m).hex(),'trainingLogicalSha256':logical_digest(training),'validationLogicalSha256':logical_digest(held)},building_id+'-subsets.refs.json')
    return ref,children


def read_points(ref, directory, raw_dir, max_bytes):
    desc=read_json(ref,directory)
    if (desc.get('kind')!='roof-point-references' or type(desc.get('schemaVersion')) is not int or desc.get('schemaVersion')!=1 or desc.get('recordEncoding')!=RECORD_ENCODING
        or desc.get('coordinateRecipe')!=COORDINATE_RECIPE or desc.get('order')!=ORDER): raise ValueError('unsupported point reference version/encoding/recipe/order')
    count=desc.get('count')
    if type(count) is not int or count<0 or count*POINT_DTYPE.itemsize>max_bytes: raise ValueError('point allocation bound')
    records=read_array(desc['records'],directory,RECORD_DTYPE,count,max_bytes)
    shas=desc['sourceShas']; validate_records(records,shas,count)
    sources=read_json(desc['sources'],directory)
    by_sha,raw=source_dictionary(sources,shas)
    out=np.empty(count,dtype=POINT_DTYPE)
    for index,sha in enumerate(shas):
        if sha not in by_sha or sha not in raw: raise ValueError('missing source metadata/raw object')
        source=dict(by_sha[sha],path=str(verified_path(raw[sha],raw_dir,'sources')))
        import laspy
        with laspy.open(source['path']) as reader:
            if reader.header.point_count*POINT_DTYPE.itemsize>max_bytes:raise ValueError('source node allocation bound')
        node=decode_source(source)
        start,end=np.searchsorted(records['sourceIndex'],[index,index+1])
        ordinals=records['ordinal'][start:end]
        if len(ordinals) and int(ordinals[-1])>=len(node): raise ValueError('source ordinal out of range')
        out[start:end]=node[ordinals]
    if logical_digest(out)!=desc.get('logicalSha256'): raise ValueError('logical point hash mismatch')
    return out


def read_evidence(extracts, directory, raw_dir, ground_m=None, max_bytes=DEFAULT_MAX_BYTES):
    """Read explicit current or legacy evidence. Ground is the recorded result value."""
    result={};point_refs=[];subset_refs=[]
    for ref in extracts:
        name=ref['name']
        if name.endswith('-points.refs.json'): point_refs.append(ref)
        elif name.endswith('-subsets.refs.json'): subset_refs.append(ref)
        else:
            for role in ['points','training','validation','mask','canopyCells','vegetationDiagnostics','ground']:
                if name.endswith('-'+role+'.npy.gz'):
                    dtype=POINT_DTYPE if role in ('points','training','validation') else bool if role=='mask' else '<i8'
                    value=read_array(ref,directory,dtype,max_bytes=max_bytes,ndim=2 if role=='canopyCells' else 1)
                    if role in ('points','training','validation'): validate_points(value)
                    if role=='canopyCells' and value.shape[1:]!=(2,):raise ValueError('invalid canopy cells')
                    if role in result:raise ValueError('duplicate evidence role')
                    result[role]=value
                elif name.endswith('-'+role+'.json'):
                    if role in result:raise ValueError('duplicate evidence role')
                    result[role]=read_json(ref,directory)
    if len(point_refs)>1 or len(subset_refs)>1 or (point_refs and 'points' in result):raise ValueError('duplicate evidence role')
    if point_refs:result['points']=read_points(point_refs[0],directory,raw_dir,max_bytes)
    if subset_refs:
        desc=read_json(subset_refs[0],directory)
        if desc.get('kind')!='roof-point-subsets' or type(desc.get('schemaVersion')) is not int or desc.get('schemaVersion')!=1 or desc.get('rowEncoding')!='npy-gzip-u64-le-v1':raise ValueError('unsupported subset version/encoding')
        if len(point_refs)!=1 or desc['points']!=point_refs[0] or 'training' in result or 'validation' in result:raise ValueError('subset point role mismatch')
        try:ground=float.fromhex(desc['groundMHex'])
        except (ValueError,TypeError,KeyError) as error:raise ValueError('invalid ground') from error
        if ground_m is None or not np.isfinite(ground) or ground.hex()!=desc['groundMHex'] or float(ground_m).hex()!=ground.hex():raise ValueError('ground result mismatch')
        pre=read_array(desc['preTrainingRows'],directory,'<u8',desc['preTrainingCount'],max_bytes)
        validation=read_array(desc['validationRows'],directory,'<u8',desc['validationCount'],max_bytes)
        mask=read_array(desc['mask'],directory,bool,len(pre),max_bytes)
        if 'mask' in result and not np.array_equal(mask,result['mask']):raise ValueError('mask role mismatch')
        training,held=subset_arrays(result['points'],pre,validation,mask,ground)
        if logical_digest(training)!=desc['trainingLogicalSha256'] or logical_digest(held)!=desc['validationLogicalSha256']:raise ValueError('logical subset hash mismatch')
        result.update(training=training,validation=held,mask=mask)
    return result
