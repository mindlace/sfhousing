import unittest
import json
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

    def test_cli_pins_output_precision_density_units_and_flat_ground_for_all_candidates(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        f = load('fit')
        points = np.array([(50001.,25001.,28.,1)],dtype=[('x','f8'),('y','f8'),('z','f8'),('classification','u1')])
        building = {'buildingId':'flags','heightM':8,'footprint':{'type':'Polygon','coordinates':[[[50000,25000],[50010,25000],[50010,25010],[50000,25000]]]}}
        with tempfile.TemporaryDirectory() as d:
            with patch.object(f.subprocess,'run',return_value=SimpleNamespace(returncode=1,stdout='',stderr='boundary test')) as run:
                candidates = f.fit_candidates(building,points,20.,{'workDir':d})
                candidates.append(f.fit_one(building,points,20.,{'workDir':d},'retry',.6,50))
            self.assertEqual([c['name'] for c in candidates],['simplified','reference','retry'])
            self.assertEqual(len(run.call_args_list),3)
            for call,complexity,support in zip(run.call_args_list,['0.4','0.888','0.6'],['50','15','50']):
                args=call.args[0]
                for flag,values in [('--cj-scale',['0.0001']*3),('--min-building-density',['1']),('--unit-scale',['1']),('--jobs',['1']),('--bld-class',['1']),('--grnd-class',['2']),('--h-terrain-strategy',['user']),('--complexity-factor',[complexity]),('--plane-detect-min-points',[support])]:
                    self.assertIn(flag,args)
                    start=args.index(flag)+1
                    self.assertEqual(args[start:start+len(values)],values)
                self.assertIn('--no-clip-terrain',args)
                self.assertIn('--lod22',args)
            footprint=json.loads((Path(d)/'flags/retry/footprint.geojson').read_text())
            self.assertEqual(footprint['features'][0]['properties']['groundM'],20.)

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
