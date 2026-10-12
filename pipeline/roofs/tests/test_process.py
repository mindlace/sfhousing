import unittest
import tempfile
import json
from pathlib import Path
from test_filter import load


class ProcessTests(unittest.TestCase):
    def test_outside_nominal_coverage_never_uses_incidental_points_and_keeps_all_outcomes(self):
        p = load('process')
        with tempfile.TemporaryDirectory() as d:
            building = {'buildingId':'outside','footprintHash':'h','heightM':10,'bbox':[50000,25000,50010,25010],'footprint':{'type':'Polygon','coordinates':[[[50000,25000],[50010,25000],[50010,25010],[50000,25010],[50000,25000]]]}}
            job = {'schemaVersion':1,'datasetVersion':'test','buildings':[building,dict(building,buildingId='outside2')],'sources':[],'sourceStatus':[{'sourceId':'roof-lidar','spatial':{'coverage':[{'id':'other','bbox':[-120,35,-119,36]}]}}],'workDir':d,'toolchainHash':'0'*64,'configPath':str(Path(__file__).parents[1]/'config.json')}
            result = p.process_job(job)
            self.assertEqual([b['buildingId'] for b in result['buildings']],['outside','outside2'])
            self.assertEqual([b['reason'] for b in result['buildings']],['not_in_coverage']*2)
            self.assertTrue(all(b['archives'] for b in result['buildings']))
            for archive in result['archives']:
                self.assertTrue(archive['archiveKey'].startswith('roof-processing/'))
                if archive['name'].endswith('input.json'):
                    saved = json.loads((Path(d)/'artifacts'/archive['sha256']).read_text())
                    self.assertNotIn('workDir',saved)
                    self.assertNotIn('configPath',saved)

    def test_corrupt_locked_image_fails_integrity_even_when_building_outside_coverage(self):
        p = load('process')
        with tempfile.TemporaryDirectory() as d:
            image = Path(d)/'bad.png'; image.write_bytes(b'x')
            import hashlib
            job = {'schemaVersion':1,'datasetVersion':'test','buildings':[],'sources':[{'kind':'aerial','path':str(image),'sha256':hashlib.sha256(b'x').hexdigest(),'name':'bad.png','tiles':[{'width':512,'height':512,'transform':[1,0,0,0,-1,0]}]}],'sourceStatus':[],'workDir':d,'toolchainHash':'0'*64,'configPath':str(Path(__file__).parents[1]/'config.json')}
            with self.assertRaisesRegex(ValueError,'aerial'):
                p.process_job(job)

    def test_salesforce_override_requires_both_production_identity_and_hash_and_keeps_authored_limits(self):
        p = load('process')
        record = json.loads((Path(__file__).parents[1]/'overrides/salesforce.json').read_text())
        building = {'buildingId':record['buildingId'],'footprintHash':record['footprintHash'],'footprint':record['productionFootprint'],'heightM':326}
        result = p.landmark_override(building)
        self.assertIsNotNone(result)
        self.assertEqual(result['reason'],'roof_coverage_low')
        self.assertTrue(result['followUp']['revisit'])
        self.assertLessEqual(result['candidates'][0]['metrics']['triangleCount'],16384)
        self.assertEqual(result['override']['approximateRelativeRangesM'],[[0,35],[280,330]])
        self.assertEqual(p.landmark_override(dict(building,footprintHash='0'*64))['reason'],'override_stale')
        self.assertIsNone(p.landmark_override(dict(building,buildingId='unrelated')))

    def test_real_building_processing_archives_are_byte_identical_and_portable_across_scratch_dirs(self):
        import sys,gzip,io
        sys.path.insert(0,str(Path(__file__).parent))
        from test_real_cases import CASES,FIXTURES
        from pyproj import Transformer
        import numpy as np
        p=load('process');case=CASES[1]
        tx=Transformer.from_crs('EPSG:7131','EPSG:4326',always_xy=True)
        bbox=list(tx.transform_bounds(*case['building']['bbox'],densify_pts=21))
        bbox=[bbox[0]-.00001,bbox[1]-.00001,bbox[2]+.00001,bbox[3]+.00001]
        spatial={'horizontalCrs':'EPSG:7131','verticalCrs':None,'horizontalUnits':'m','verticalUnits':'m','acquisitionStart':None,'acquisitionEnd':None,'coverage':[{'id':'fixture','bbox':bbox}],'supportBufferM':50,'permission':'confirmed','alignment':'not-applicable','objects':[]}
        source=dict(spatial,kind='lidar',sourceId='roof-lidar',name=case['file'],path=str((FIXTURES/case['file']).resolve()),sha256=case['sha256'],url='https://example.test/derived-fixture')
        with tempfile.TemporaryDirectory() as directory:
            job={'schemaVersion':1,'datasetVersion':'test','buildings':[case['building']],'sources':[source],'sourceArchives':[{'name':case['file'],'sha256':case['sha256'],'bytes':Path(source['path']).stat().st_size,'archiveKey':f"sources/{case['sha256']}.laz"}],'sourceStatus':[{'sourceId':'roof-lidar','spatial':spatial}],'toolchainHash':'0'*64,'configPath':str(Path(__file__).parents[1]/'config.json')}
            first=p.process_job(dict(job,workDir=directory+'/first'))
            second=p.process_job(dict(job,workDir=directory+'/second'))
            self.assertEqual(p.canonical(first),p.canonical(second))
            self.assertIsNotNone(first['buildings'][0]['mesh'])
            self.assertTrue(any(a['name'].endswith('-points.refs.json') for a in first['archives']))
            from point_archives import read_evidence
            raw=Path(directory)/'raw';raw.mkdir();(raw/case['sha256']).write_bytes(Path(source['path']).read_bytes())
            saved=read_evidence(first['buildings'][0]['archives'],Path(directory)/'first/artifacts',raw,ground_m=first['buildings'][0]['ground']['groundM'])['points']
            self.assertEqual(np.unique(saved['sourceSha']).tolist(),[case['sha256']])
            self.assertEqual(saved['ordinal'][0],0)
            for archive in first['archives']:
                self.assertEqual((Path(directory)/'first/artifacts'/archive['sha256']).read_bytes(),(Path(directory)/'second/artifacts'/archive['sha256']).read_bytes())

    def test_sparse_canopy_diagnostics_are_preserved_outside_contractual_flags(self):
        import numpy as np
        p=load('process')
        building={'buildingId':'sparse','footprintHash':'h','heightM':10,'footprint':{'type':'Polygon','coordinates':[[[0,0],[10,0],[10,10],[0,10],[0,0]]]}}
        points=np.array([(1.,1.,10.,1,'0'*64,0),(2.,2.,10.,1,'0'*64,1),(1.,1.,0.,2,'0'*64,2)],dtype=[('x','f8'),('y','f8'),('z','f8'),('classification','u1'),('sourceSha','U64'),('ordinal','u8')])
        image=np.full((100,100,3),80,dtype='u1')
        source={'permission':'confirmed','alignment':'verified','horizontalCrs':'EPSG:7131'}
        tile={'width':100,'height':100,'transform':[.1,0,0,0,-.1,10]}
        result,evidence=p.process_building(building,points,[(source,image,tile)],{'cellM':.5})
        self.assertEqual(result['flags'],['vegetation_ambiguous'])
        self.assertEqual(result['diagnostics']['vegetation'],['pca_insufficient'])
        self.assertEqual(evidence['vegetationDiagnostics'],['pca_insufficient'])
        self.assertEqual(result['method'],'footprint')
        self.assertEqual(result['usedSources'],['roof-lidar','roof-aerial'])
        no_ground=points[points['classification']==1]
        failed,_=p.process_building(building,no_ground,[],{'cellM':.5})
        self.assertEqual(failed['reason'],'ground_missing')
        self.assertNotIn('returnCounts',failed)
        self.assertEqual(failed['usedSources'],['roof-lidar'])

    def test_job_rejects_changed_unsupported_configuration(self):
        p=load('process')
        with tempfile.TemporaryDirectory() as d:
            config=json.loads((Path(__file__).parents[1]/'config.json').read_text())
            config['acceptance']['roofCoverage']=.5
            path=Path(d)/'config.json';path.write_text(json.dumps(config))
            with self.assertRaisesRegex(ValueError,'unsupported roof configuration'):
                p.process_job({'schemaVersion':1,'buildings':[],'configPath':str(path),'workDir':d,'sources':[],'sourceStatus':[],'toolchainHash':'0'*64,'datasetVersion':'fixture-0'})

    def test_salesforce_production_metadata_matches_current_fallback(self):
        p=load('process');record=json.loads((Path(__file__).parents[1]/'overrides/salesforce.json').read_text())
        result=p.landmark_override({'buildingId':record['buildingId'],'footprintHash':record['footprintHash'],'footprint':record['productionFootprint'],'heightM':326})
        self.assertEqual(record['productionValidation']['reason'],result['reason'])
