"""USGS fixture regression; original aerials are opt-in local research evidence only."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
import sys
import numpy as np
import laspy
sys.path.insert(0,str(Path(__file__).parents[1]))
from process import process_building
from shapely.geometry import shape
from filter import estimate_ground
from fit import fit_candidates
from quality import select_candidate

FIXTURES = Path(__file__).parents[2]/'test/fixtures/roofs'
CASES = json.loads((FIXTURES/'real-cases.json').read_text())


def cloud(case):
    path = FIXTURES/case['file']
    if hashlib.sha256(path.read_bytes()).hexdigest() != case['sha256']: raise ValueError('fixture SHA mismatch')
    las = laspy.read(path)
    p = np.empty(len(las.points),dtype=[('x','f8'),('y','f8'),('z','f8'),('classification','u1'),('sourceSha','U64'),('ordinal','u8')])
    p['x'],p['y'],p['z'] = las.x,las.y,las.z
    p['classification'] = las.classification; p['sourceSha'] = case['sha256']; p['ordinal'] = np.arange(len(p),dtype='u8')
    return p


def config(directory):
    return dict(json.loads((Path(__file__).parents[1]/'config.json').read_text()),workDir=directory)


class RealCaseTests(unittest.TestCase):
    def test_protected_real_pitch_is_retained_by_reference_and_every_case_has_outcome(self):
        with tempfile.TemporaryDirectory() as d:
            results = [process_building(c['building'],cloud(c),[],config(d))[0] for c in CASES]
            self.assertEqual(len(results),3)
            self.assertTrue(all(r['mesh'] is not None or r['reason'] for r in results))
            pitch = results[2]
            self.assertIsNotNone(pitch['mesh'],pitch)
            selected = next(c for c in pitch['candidates'] if c['name']==pitch['selectedCandidate'])
            self.assertGreater(selected['metrics']['pitchedFraction'],.35)
            self.assertEqual(pitch['selectedCandidate'],'reference')
            cap = results[1]
            self.assertIsNotNone(cap['mesh'],cap)
            selected = next(c for c in cap['candidates'] if c['name']==cap['selectedCandidate'])
            self.assertEqual(selected['metrics']['spikes'],0)

    @unittest.skipUnless(os.environ.get('ROOF_LOCAL_AERIAL_RESEARCH')=='1','original cached aerial rights unconfirmed; opt-in local research only')
    def test_local_original_aerial_wholefoods_retains_levels_and_demonstrates_filter_effect(self):
        from PIL import Image
        case = CASES[0]; site = case['site']
        root = Path(os.environ.get('ROOF_LOCAL_AERIAL_DIR','/tmp/sfh-roofline-spike'))
        meta = json.loads((root/(site+'-aerial.json')).read_text())
        rgb = np.array(Image.open(root/(site+'-aerial.png')).convert('RGB'))
        tile = {'width':rgb.shape[1],'height':rgb.shape[0],'transform':[meta['resolution_3857_m'],0,meta['left'],0,-meta['resolution_3857_m'],meta['top']]}
        # Research permissions here are explicit local opt-in, never published-input rights.
        source = {'permission':'confirmed','alignment':'verified','horizontalCrs':'EPSG:3857'}
        with tempfile.TemporaryDirectory() as d:
            unmasked,_ = process_building(case['building'],cloud(case),[],config(d+'/unmasked'))
            masked,_ = process_building(case['building'],cloud(case),[(source,rgb,tile)],config(d+'/masked'))
            self.assertIsNotNone(masked['mesh'],masked)
            vertices = np.array(masked['mesh']['vertices']); lower=upper=0
            for tri,semantic in zip(masked['mesh']['triangles'],masked['mesh']['semantics']):
                if semantic != 'RoofSurface': continue
                abc=vertices[tri]; area=abs(np.cross(abc[1]-abc[0],abc[2]-abc[0])[2])/2
                if abc[:,2].mean() < 8: lower+=area
                else: upper+=area
            maximum = vertices[:,2].max()
            raw_max = max(c['metrics'].get('maxHeightM') or 0 for c in unmasked['candidates'])
            print(json.dumps({'case':'wholefoods','lowerAreaM2':lower,'upperAreaM2':upper,'maskedMaxM':maximum,'unmaskedMaxM':raw_max,'maskedOutcome':masked['method'],'unmaskedOutcome':unmasked['reason'],'rejected':masked['returnCounts']['rejected']}))
            self.assertGreater(lower,800)
            self.assertGreater(upper,150)
            self.assertLess(maximum,13)
            self.assertGreater(raw_max,18)
