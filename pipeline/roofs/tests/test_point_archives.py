"""Private evidence: exact identities, source decode, and hostile physical bodies."""
import gzip
import hashlib
import importlib.util
import io
import json
import struct
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import laspy

class PointArchivesTests(unittest.TestCase):
    def codec(self):
        self.assertIsNotNone(importlib.util.find_spec('point_archives'), 'private reference codec is required')
        import point_archives
        return point_archives

    def fixture(self, root, crs='EPSG:7131'):
        p = self.codec()
        sources = []
        raw = root/'raw'; raw.mkdir()
        for i in range(2):
            las = laspy.LasData(laspy.LasHeader(point_format=6, version='1.4'))
            las.header.scales = [.001, .001, .001]
            las.x = np.array([i, i+1, i+2.125]); las.y = np.array([0, 1, 2.25]); las.z = np.array([.125, 10.125, 11.125])
            las.classification = np.array([2, 1, 1], dtype='u1')
            path = root/f'{i}.laz'; las.write(path)
            sha = hashlib.sha256(path.read_bytes()).hexdigest(); (raw/sha).write_bytes(path.read_bytes())
            sources.append(dict(kind='lidar', name=f'{i}.laz', path=str(path), sha256=sha, horizontalCrs=crs, horizontalUnits='m', verticalUnits='m', supportBufferM=50))
        from geometry import decode_source
        points = np.concatenate([decode_source(s) for s in sorted(sources, key=lambda s:s['sha256'])])
        archive = p.Archive(root/'artifacts')
        source_ref = archive.json({'sources':[{k:v for k,v in s.items() if k!='path'} for s in sources[::-1]], 'sourceArchives':[dict(name=s['name'],sha256=s['sha256'],bytes=Path(s['path']).stat().st_size,archiveKey=f"sources/{s['sha256']}.laz") for s in sources]}, 'sources.json')
        return p, archive, source_ref, points, raw

    def test_original_sources_replay_exact_float_bits_and_subset_mask_domain(self):
        for crs in ['EPSG:7131','EPSG:3857']:
            with self.subTest(crs=crs), tempfile.TemporaryDirectory() as d:
                p,a,s,points,raw = self.fixture(Path(d),crs)
                ref,children = p.write_points(a,points,'b',s)
                pre = np.array([0,1,3,4], dtype='<u8'); validation = np.array([2,5], dtype='<u8')
                mask = np.array([False,True,False,False]); mask_ref = a.array(mask,'b-mask.npy')
                subset,children2 = p.write_subsets(a,ref,points,pre,validation,mask,mask_ref,.125,'b')
                evidence = p.read_evidence([ref,subset,mask_ref],a.directory,raw,ground_m=.125)
                self.assertEqual(evidence['points'].tobytes(),points.tobytes())
                self.assertEqual(evidence['training'].tobytes(),points[[0,3,4]].tobytes())
                expected = points[[2,5]].copy(); expected['z'] -= .125
                self.assertEqual(evidence['validation'].tobytes(),expected.tobytes())
                self.assertEqual(evidence['mask'].tolist(),mask.tolist())
                self.assertEqual(len(children),1); self.assertEqual(len(children2),2)
                with self.assertRaisesRegex(ValueError,'ground'): p.read_evidence([ref,subset],a.directory,raw,ground_m=.25)

    def test_ground_hex_finite_canonical_boundaries(self):
        valid = ['0x1.fffffffffffffp+1023', '-0x1.fffffffffffffp+1023',
                 '0x1.0000000000000p-1022', '0x0.fffffffffffffp-1022',
                 '0x0.0000000000001p-1022', '-0x0.0000000000001p-1022',
                 '0x0.0p+0', '-0x0.0p+0']
        invalid = ['0x1.0000000000000p+1024', '0x1.0000000000000p-1075',
                   '0x1.0000000000000p-1023', '0x0.0000000000000p-1022',
                   '0x0.0p-0', '0x1.0p+0', '0x1.0000000000000p+00']
        with tempfile.TemporaryDirectory() as d:
            p,a,s,points,raw = self.fixture(Path(d))
            ref,_ = p.write_points(a,points,'b',s)
            pre=np.array([0,1,3,4],dtype='<u8'); held=np.array([2,5],dtype='<u8')
            mask=np.array([False,True,False,False]); mask_ref=a.array(mask,'b-mask.npy')
            for spelling in valid:
                ground=float.fromhex(spelling)
                sub,_=p.write_subsets(a,ref,points,pre,held,mask,mask_ref,ground,'b')
                desc=json.loads((a.directory/sub['sha256']).read_text())
                self.assertEqual(desc['groundMHex'],spelling)
                restored=p.read_evidence([ref,sub],a.directory,raw,ground_m=ground)
                expected=points[held].copy(); expected['z']-=ground
                self.assertEqual(restored['validation'].tobytes(),expected.tobytes())
            for spelling in invalid:
                bad=a.json(dict(desc,groundMHex=spelling),'b-subsets.refs.json')
                with self.subTest(spelling=spelling),self.assertRaisesRegex(ValueError,'ground'):
                    p.read_evidence([ref,bad],a.directory,raw,ground_m=-0.)

    def test_canonical_logical_digest_preserves_signed_zero_and_large_integer(self):
        p=self.codec()
        points=np.array([(-0.,1.25,2.5,2,'a'*64,2**63+17)],dtype=p.POINT_DTYPE)
        expected=hashlib.sha256(struct.pack('<dddB64sQ',-0.,1.25,2.5,2,b'a'*64,2**63+17)).hexdigest()
        self.assertEqual(p.logical_digest(points),expected)
        positive=points.copy();positive['x']=0
        self.assertNotEqual(p.logical_digest(positive),expected)
        shas=[f'{i:064x}' for i in range(65538)]
        records=np.array([(65537,2**63+17)],dtype=p.RECORD_DTYPE)
        p.validate_records(records,shas,1)
        self.assertEqual(records.itemsize,12)
        for bad in [np.array([(65538,0)],dtype=p.RECORD_DTYPE),np.array([(0,1),(0,1)],dtype=p.RECORD_DTYPE),np.array([(1,0),(0,1)],dtype=p.RECORD_DTYPE)]:
            with self.assertRaises(ValueError): p.validate_records(bad,shas,len(bad))

    def test_strict_legacy_reader_and_deterministic_streamed_writes(self):
        p=self.codec()
        with tempfile.TemporaryDirectory() as d:
            a=p.Archive(d)
            points=np.array([(1.,2.,3.,1,'f'*64,2**63+1)],dtype=p.POINT_DTYPE)
            ref=a.array(points,'b-points.npy',chunk_bytes=7)
            self.assertEqual(ref,a.array(points,'b-points.npy',chunk_bytes=8192))
            self.assertEqual(p.read_evidence([ref],d,d)['points'].tobytes(),points.tobytes())
            body=io.BytesIO();np.save(body,points,allow_pickle=False)
            legacy=a.save(gzip.compress(body.getvalue(),mtime=0),'b-points.npy.gz')
            self.assertEqual(p.read_evidence([legacy],d,d)['points'].tobytes(),points.tobytes())
            for data in [body.getvalue()[:-1],body.getvalue()+b'extra']:
                bad=a.save(gzip.compress(data,mtime=0),'b-points.npy.gz')
                with self.assertRaises(ValueError):p.read_evidence([bad],d,d)
            bad=a.save(gzip.compress(body.getvalue(),mtime=0)+gzip.compress(b'',mtime=0),'b-points.npy.gz')
            with self.assertRaises(ValueError):p.read_evidence([bad],d,d)
            for dtype in ['O','>f8']:
                body=io.BytesIO();np.save(body,np.zeros(1,dtype=dtype),allow_pickle=True)
                bad=a.save(gzip.compress(body.getvalue(),mtime=0),'b-points.npy.gz')
                with self.assertRaises(ValueError):p.read_evidence([bad],d,d)
            self.assertFalse(list(Path(d).glob('*.part')))

    def test_descriptor_corruption_and_source_conflicts_fail_closed(self):
        with tempfile.TemporaryDirectory() as d:
            p,a,s,points,raw=self.fixture(Path(d))
            ref,_=p.write_points(a,points,'b',s)
            descriptor=json.loads((a.directory/ref['sha256']).read_text())
            for key,value in [('schemaVersion',2),('schemaVersion',True),('recordEncoding','unknown'),('coordinateRecipe','unknown'),('count',7),('sourceShas',descriptor['sourceShas'][::-1]),('logicalSha256','0'*64)]:
                bad=a.json(dict(descriptor,**{key:value}),'b-points.refs.json')
                with self.subTest(key=key),self.assertRaises(ValueError):p.read_evidence([bad],a.directory,raw)
            metadata=json.loads((a.directory/s['sha256']).read_text())
            metadata['sources'].append(dict(metadata['sources'][0],name='alias'))
            alias=a.json(metadata,'sources.json')
            alias_ref=a.json(dict(descriptor,sources=alias),'b-points.refs.json')
            self.assertEqual(p.read_evidence([alias_ref],a.directory,raw)['points'].tobytes(),points.tobytes())
            metadata['sources'][-1]['supportBufferM']=51
            conflict=a.json(metadata,'sources.json')
            bad=a.json(dict(descriptor,sources=conflict),'b-points.refs.json')
            with self.assertRaisesRegex(ValueError,'conflict'):p.read_evidence([bad],a.directory,raw)
            (raw/descriptor['sourceShas'][0]).write_bytes(b'bad')
            with self.assertRaisesRegex(ValueError,'hash|length'):p.read_evidence([ref],a.directory,raw)


    def test_empty_missing_ground_and_landmark_evidence_keep_branch_shapes(self):
        import process
        p=self.codec()
        with tempfile.TemporaryDirectory() as d:
            a=p.Archive(d);src=a.json({'sources':[],'sourceArchives':[]},'sources.json')
            empty=np.empty(0,dtype=p.POINT_DTYPE)
            ref,_=p.write_points(a,empty,'empty',src)
            restored=p.read_evidence([ref],d,d)
            self.assertEqual(list(restored),['points']);self.assertEqual(len(restored['points']),0)
            building={'buildingId':'missing','footprintHash':'h','heightM':10,'footprint':{'type':'Polygon','coordinates':[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}}
            points=np.array([(1.,1.,10.,1,'0'*64,0)],dtype=p.POINT_DTYPE)
            old,old_ev=expanded_control(building,points,[],{'cellM':.5});new,new_ev=process.process_building(building,points,[],{'cellM':.5})
            self.assertEqual(new,old);self.assertEqual(new_ev,old_ev);self.assertEqual(set(new_ev),{'ground'})
            override=json.loads((Path(__file__).parents[1]/'overrides/salesforce.json').read_text())
            building=dict(building,buildingId=override['buildingId'],footprintHash=override['footprintHash'],footprint=override['productionFootprint'],heightM=326)
            old,old_ev=expanded_control(building,empty,[],{'cellM':.5});new,new_ev=process.process_building(building,empty,[],{'cellM':.5})
            self.assertEqual(new,old);self.assertEqual(new_ev,old_ev);self.assertEqual(new_ev,{})

    def test_writer_refuses_missing_raw_closure_before_committing_reference(self):
        with tempfile.TemporaryDirectory() as d:
            p,a,s,points,raw=self.fixture(Path(d))
            metadata=json.loads((a.directory/s['sha256']).read_text());metadata['sourceArchives']=[]
            missing=a.json(metadata,'sources.json')
            before=set(a.directory.iterdir())
            with self.assertRaisesRegex(ValueError,'source'):
                p.write_points(a,points,'b',missing)
            self.assertEqual(set(a.directory.iterdir()),before)

    def test_hostile_records_subsets_and_partial_writes_fail_closed(self):
        from unittest.mock import patch
        p=self.codec()
        with tempfile.TemporaryDirectory() as d:
            p,a,s,points,raw=self.fixture(Path(d))
            ref,_=p.write_points(a,points,'b',s)
            desc=json.loads((a.directory/ref['sha256']).read_text())
            records=p.read_array(desc['records'],a.directory,p.RECORD_DTYPE,6)
            for change in ('ordinal','index','duplicate','dtype','endian','count'):
                altered=records.copy();count=6
                if change=='ordinal':altered['ordinal'][-1]=2**63+1
                if change=='index':altered['sourceIndex'][-1]=2
                if change=='duplicate':altered[-1]=altered[-2]
                if change=='dtype':altered=altered.astype([('sourceIndex','<u2'),('ordinal','<u8')])
                if change=='endian':altered=altered.astype([('sourceIndex','>u4'),('ordinal','>u8')])
                if change=='count':count=5
                child=a.array(altered,'b-point-records.npy')
                bad=a.json(dict(desc,records=child,count=count),'b-points.refs.json')
                with self.subTest(change=change),self.assertRaises(ValueError):p.read_evidence([bad],a.directory,raw)
            pre=np.array([0,1,3,4],dtype='<u8');held=np.array([2,5],dtype='<u8');mask=np.array([False,True,False,False])
            mask_ref=a.array(mask,'b-mask.npy');sub,_=p.write_subsets(a,ref,points,pre,held,mask,mask_ref,.125,'b')
            sd=json.loads((a.directory/sub['sha256']).read_text())
            for key,value in [('schemaVersion',2),('groundMHex','0.125'),('preTrainingCount',3),('validationCount',3),('rowEncoding','unknown')]:
                bad=a.json(dict(sd,**{key:value}),'b-subsets.refs.json')
                with self.subTest(key=key),self.assertRaises(ValueError):p.read_evidence([ref,bad],a.directory,raw,ground_m=.125)
            for rows in [np.array([0,0],dtype='<u8'),np.array([3,0],dtype='<u8'),np.array([6],dtype='<u8'),np.array([0],dtype='<u4')]:
                with self.assertRaises(ValueError):p.subset_arrays(points,rows,held,mask[:len(rows)],.125)
            with self.assertRaisesRegex(ValueError,'overlap'):p.subset_arrays(points,pre,pre,mask,.125)
            with self.assertRaisesRegex(ValueError,'ground'):p.subset_arrays(points,pre,held,np.ones(4,dtype=bool),.125)
            with self.assertRaisesRegex(ValueError,'bound'):p.read_evidence([ref],a.directory,raw,max_bytes=10)
            before=set(a.directory.iterdir())
            def broken(stream,header):stream.write(b'partial');raise OSError('injected write failure')
            with patch.object(np.lib.format,'write_array_header_1_0',side_effect=broken):
                with self.assertRaises(OSError):a.array(points,'failed.npy')
            self.assertEqual(set(a.directory.iterdir()),before)

    def test_permitted_aerial_frozen_native_parity_and_independent_membership(self):
        import copy
        from unittest.mock import patch
        import process
        import fit
        p=self.codec()
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);raw=root/'raw';raw.mkdir()
            # Existing permitted synthetic RGB/PCA fixture, with noise and a courtyard.
            smooth=[(x,y,5.125,1) for x in np.arange(0,4,.1) for y in np.arange(0,4,.1)]
            canopy=[(5+x*.02,1+y*.02,9.125+z*.2,1) for x in range(10) for y in range(10) for z in range(15)]
            rows=smooth+canopy+[(5.1,1.1,.125,2),(.5,.5,99,7),(.6,.6,99,18)]
            las=laspy.LasData(laspy.LasHeader(point_format=6,version='1.4'))
            las.header.scales=[.001]*3
            las.x,las.y,las.z=np.array(rows)[:,:3].T;las.classification=np.array(rows)[:,3].astype('u1')
            path=root/'source.laz';las.write(path);sha=hashlib.sha256(path.read_bytes()).hexdigest();(raw/sha).write_bytes(path.read_bytes())
            source=dict(kind='lidar',name='source.laz',path=str(path),sha256=sha,horizontalCrs='EPSG:7131',horizontalUnits='m',verticalUnits='m',supportBufferM=50)
            from geometry import decode_source
            points=decode_source(source)
            building={'buildingId':'aerial','footprintHash':'h','heightM':5,'bbox':[0,0,6,4],'footprint':{'type':'Polygon','coordinates':[[[0,0],[6,0],[6,4],[0,4],[0,0]],[[.8,.8],[.8,1.2],[1.2,1.2],[1.2,.8],[.8,.8]]]}}
            from geometry import footprint_hash
            building['footprintHash']=footprint_hash(building['footprint'])
            rgb=np.full((100,100,3),80,dtype='u1');rgb[:,50:70]=[20,150,20]
            images=[({'permission':'confirmed','alignment':'verified','horizontalCrs':'EPSG:7131'},rgb,{'transform':[.1,0,0,0,-.1,8],'width':100,'height':100})]
            config=dict(json.loads((Path(__file__).parents[1]/'config.json').read_text()),workDir=str(root/'old'))
            # Capture original native CityJSON once; replay it while exercising the real
            # fitter's LAZ/footprint encoding and candidate decoding on the new path.
            native=fit.subprocess.run; captures=[]
            def capture(args,**kwargs):
                result=native(args,**kwargs)
                output=Path(args[-1])
                captures.append((result,[(f.relative_to(output),f.read_bytes()) for f in output.rglob('*') if f.is_file()]))
                return result
            with patch.object(fit.subprocess,'run',side_effect=capture):
                old,old_evidence=expanded_control(building,points,images,config)
            calls=iter(captures)
            def replay(args,**kwargs):
                result,files=next(calls)
                output=Path(args[-1]);output.mkdir(parents=True,exist_ok=True)
                for relative,data in files:
                    target=output/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
                return copy.copy(result)
            config['workDir']=str(root/'new')
            with patch.object(fit.subprocess,'run',side_effect=replay):
                new,evidence=process.process_building(building,points,images,config)
            self.assertGreaterEqual(len(captures),2)
            self.assertEqual([c['name'] for c in old['candidates']][:2],['simplified','reference'])
            self.assertTrue(any(c['mesh'] is not None for c in old['candidates']))
            self.assertEqual(process.canonical(old),process.canonical(new))
            self.assertGreater(int(evidence['mask'].sum()),100)
            self.assertGreater(len(evidence['validation']),20)
            for role in ('training','validation','mask','canopyCells'):
                self.assertEqual(evidence[role].tobytes(),old_evidence[role].tobytes(),role)
            for path in (root/'old').rglob('*'):
                if path.name in ('training.laz','footprint.geojson'):
                    self.assertEqual(path.read_bytes(),(root/'new'/path.relative_to(root/'old')).read_bytes())
            # Independently check full-extract selectors, including noise/holes and
            # pre-rejection mask domain, without recovering membership from floats.
            from shapely.geometry import Point
            footprint=shape(building['footprint'])
            pre=[];held=[]
            cells={tuple(row) for row in evidence['canopyCells']}
            for i,row in enumerate(points):
                c=int(row['classification']);inside=footprint.contains(Point(float(row['x']),float(row['y'])))
                validation=int.from_bytes(hashlib.sha256(f"{sha}:{int(row['ordinal'])}".encode('ascii')).digest()[:4],'big')%5==0
                if c in (7,18):continue
                if not validation and ((inside and c==1) or c==2):pre.append(i)
                cell=tuple(np.floor([row['x']/.5,row['y']/.5]).astype(int))
                if validation and inside and c==1 and cell not in cells:held.append(i)
            self.assertEqual(evidence['preTrainingRows'].tolist(),pre)
            self.assertEqual(evidence['validationRows'].tolist(),held)
            a=p.Archive(root/'archives')
            src=a.json({'sources':[{k:v for k,v in source.items() if k!='path'}],'sourceArchives':[{'name':'source.laz','sha256':sha,'bytes':(raw/sha).stat().st_size,'archiveKey':f'sources/{sha}.laz'}]},'sources.json')
            point_ref,_=p.write_points(a,points,'aerial',src);mask=a.array(evidence['mask'],'aerial-mask.npy')
            subset,_=p.write_subsets(a,point_ref,points,evidence['preTrainingRows'],evidence['validationRows'],evidence['mask'],mask,new['ground']['groundM'],'aerial')
            restored=p.read_evidence([point_ref,subset,mask],a.directory,raw,ground_m=new['ground']['groundM'])
            for role in ('training','validation','mask'):
                self.assertEqual(restored[role].tobytes(),old_evidence[role].tobytes(),role)
            # Optional output for the TypeScript export/audit integration test; all
            # numerical processing above is the same asserted frozen-native comparison.
            import os,shutil
            if destination:=os.environ.get('ROOF_PARITY_OUTPUT'):
                target=Path(destination);target.mkdir(parents=True,exist_ok=True)
                config_ref=a.save((Path(__file__).parents[1]/'config.json').read_bytes(),'config.json')
                source_meta=json.loads((a.directory/src['sha256']).read_text());source_meta['sourceStatus']=[]
                src=a.json(source_meta,'sources.json')
                from clip import clip_building
                exports=[]
                for mode,result,ev in [('old',old,old_evidence),('new',new,evidence)]:
                    refs=[]
                    if mode=='old':
                        refs.append(a.array(points,'aerial-points.npy'))
                        for role,value in ev.items():
                            refs.append(a.array(value,'aerial-'+role+'.npy') if isinstance(value,np.ndarray) else a.json(value,'aerial-'+role+'.json'))
                    else:
                        refs=[point_ref,subset,mask]
                    refs.extend(a.json(candidate,'aerial-'+candidate['name']+'.json') for candidate in result['candidates'])
                    inp=a.json({'schemaVersion':1,'datasetVersion':'fixture-0','building':building,'sources':src,'config':config_ref,'extracts':refs},'aerial-input.json')
                    result=copy.deepcopy(result);result['archives']=[*refs,inp,src,config_ref]
                    pieces=clip_building(result['mesh'],[{'buildingId':'aerial','parcelId':'parcel','geometry':building['footprint']}])
                    exports.append({'building':result,'pieces':pieces})
                (target/'parity.json').write_bytes(process.canonical(exports))
                shutil.copytree(a.directory,target/'artifacts')


# Frozen expanded selector/control from fcb0e79; fitter and quality code share the baseline.
from process import (landmark_override, shape, estimate_ground, validation_partition, contains_xy,
    building_mask, apply_cells, fallback, fit_candidates, select_candidate, fit_one)
def expanded_control(building, points, images, config):
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


if __name__=='__main__':unittest.main()
