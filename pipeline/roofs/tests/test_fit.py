import unittest
import tempfile
from pathlib import Path
import numpy as np
from test_filter import load


class FitTests(unittest.TestCase):
    def test_missing_ground_cannot_invoke_roofer_tile_minimum_fallback(self):
        f = load('fit')
        with self.assertRaisesRegex(ValueError,'ground'):
            f.fit_candidates({},np.empty(0),None,{})

    def test_actual_roofer_receives_supplied_ground_and_returns_closed_pitched_candidates(self):
        f = load('fit')
        q = load('quality')
        with tempfile.TemporaryDirectory() as d:
            building = {'buildingId':'test-roof','footprintHash':'h','heightM':8,'footprint':{'type':'Polygon','coordinates':[[[50000,25000],[50010,25000],[50010,25010],[50000,25010],[50000,25000]]]}}
            points = np.array([(50000+x,25000+y,20+6+.4*min(x,10-x),1) for x in np.arange(.1,10,.2) for y in np.arange(.1,10,.2)],dtype=[('x','f8'),('y','f8'),('z','f8'),('classification','u1')])
            candidates = f.fit_candidates(building,points,20.,{'workDir':d})
            self.assertEqual([c['name'] for c in candidates],['simplified','reference'])
            for candidate in candidates:
                self.assertIsNotNone(candidate['mesh'],candidate.get('error'))
                metrics = q.mesh_metrics(candidate['mesh'],building)
                self.assertIsNone(metrics['reason'],metrics)
                self.assertGreater(metrics['pitchedFraction'],.35)
                self.assertLess(metrics['maxHeightM'],9)

    def test_identical_real_clouds_have_exact_candidate_bytes_despite_roofer_face_order(self):
        import sys,json
        sys.path.insert(0,str(Path(__file__).parent))
        from test_real_cases import CASES,cloud,config
        from process import process_building,canonical
        with tempfile.TemporaryDirectory() as d:
            for case in CASES:
                first,_=process_building(case['building'],cloud(case),[],config(d+'/first'))
                second,_=process_building(case['building'],cloud(case),[],config(d+'/second'))
                self.assertEqual(canonical(first),canonical(second))
