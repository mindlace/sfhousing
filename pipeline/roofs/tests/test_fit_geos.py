"""Actual malformed native face must fail one candidate, not the whole roof job."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from pyproj import Transformer
from shapely.errors import GEOSException
from test_real_cases import CASES, FIXTURES, cloud
import fit
from process import process_job


FACE = json.loads((FIXTURES/'marina-invalid-face.json').read_text())


class InvalidNativeFaceTests(unittest.TestCase):
    def test_archived_marina_face_reproduces_native_triangulation_failure(self):
        with self.assertRaisesRegex(GEOSException,'Unable to find a convex corner'):
            fit.decode_cityjson(FACE['feature'],FACE['transform'],FACE['groundM'])

    def test_invalid_native_face_keeps_reference_and_next_building_available(self):
        # Replace only the external producer for one attempt. Decoding, QA, the
        # next native roofer calls, source loading and job archival all stay real.
        case = CASES[1]
        bid = FACE['provenance']['buildingId']
        buildings = [dict(case['building'],buildingId=bid),
                     dict(case['building'],buildingId='next-building')]
        tx = Transformer.from_crs('EPSG:7131','EPSG:4326',always_xy=True)
        w,s,e,n = tx.transform_bounds(*case['building']['bbox'],densify_pts=21)
        spatial = {'horizontalCrs':'EPSG:7131','verticalCrs':None,
                   'horizontalUnits':'m','verticalUnits':'m',
                   'acquisitionStart':None,'acquisitionEnd':None,
                   'coverage':[{'id':'fixture','bbox':[w-.00001,s-.00001,e+.00001,n+.00001]}],
                   'supportBufferM':50,'permission':'confirmed',
                   'alignment':'not-applicable','objects':[]}
        source = dict(spatial,kind='lidar',sourceId='roof-lidar',name=case['file'],
                      path=str((FIXTURES/case['file']).resolve()),sha256=case['sha256'],
                      url='https://example.test/derived-fixture')
        native_run = subprocess.run

        def archived_output(args, **kwargs):
            work = Path(kwargs['cwd'])
            if work.parent.name == bid and work.name == 'simplified':
                output = work/'output'; output.mkdir()
                header = {'type':'CityJSON','version':'2.0','transform':FACE['transform']}
                (output/'failed-face.city.jsonl').write_text(
                    json.dumps(header)+'\n'+json.dumps(FACE['feature'])+'\n')
                return subprocess.CompletedProcess(args,0,'archived malformed native face\n','')
            return native_run(args, **kwargs)

        with tempfile.TemporaryDirectory() as directory:
            job = {'schemaVersion':1,'datasetVersion':'test','buildings':buildings,
                   'sources':[source],'sourceStatus':[{'sourceId':'roof-lidar','spatial':spatial}],
                   'toolchainHash':'0'*64,'configPath':str(Path(__file__).parents[1]/'config.json'),
                   'workDir':directory}
            with patch.object(fit.subprocess,'run',side_effect=archived_output):
                result = process_job(job)
            first,second = result['buildings']
            self.assertEqual([first['buildingId'],second['buildingId']],[bid,'next-building'])
            rejected = first['candidates'][0]
            self.assertEqual((rejected['name'],rejected['complexity'],rejected['planeSupport']),
                             ('simplified',.4,50))
            self.assertIsNone(rejected['mesh'])
            self.assertIn('invalid roofer geometry',rejected['error'])
            self.assertIn('Unable to find a convex corner',rejected['error'])
            self.assertEqual(rejected['metrics']['reason'],'fit_failed')
            self.assertEqual(first['selectedCandidate'],'reference')
            for building in [first,second]:
                self.assertEqual(building['method'],'lidar_only')
                self.assertIsNone(building['reason'])
                self.assertIsNotNone(building['mesh'])
            saved = next(a for a in first['archives'] if a['name']==bid+'-simplified.json')
            self.assertEqual(json.loads((Path(directory)/'artifacts'/saved['sha256']).read_text()),
                             rejected)
            work = Path(directory)/bid/'simplified'
            self.assertIn('archived malformed native face',(work/'roofer.log').read_text())
            rows = (work/'output/failed-face.city.jsonl').read_text().splitlines()
            self.assertEqual(json.loads(rows[1]),FACE['feature'])

    def test_missing_required_roofer_is_not_downgraded_to_candidate_rejection(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory)/'missing-roofer'
            with patch.object(fit,'ROOFER',missing):
                with self.assertRaisesRegex(FileNotFoundError,'required roofer'):
                    fit.fit_candidates(CASES[1]['building'],cloud(CASES[1]),20.,{'workDir':directory})
