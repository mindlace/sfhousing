import unittest
import numpy as np
from test_filter import load


def prism(pitched=False, z=10):
    vertices = [[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,z],[10,0,z+2 if pitched else z],[10,10,z+2 if pitched else z],[0,10,z]]
    faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]]
    return {'vertices':vertices,'triangles':faces,'semantics':['GroundSurface']*2+['RoofSurface']*2+['WallSurface']*8}


class QualityTests(unittest.TestCase):
    def test_rejects_open_nonfinite_negative_and_low_coverage_meshes(self):
        q = load('quality')
        building = {'buildingId':'b','footprintHash':'h','footprint':{'type':'Polygon','coordinates':[[[0,0],[10,0],[10,10],[0,10],[0,0]]]},'heightM':10}
        self.assertIsNone(q.mesh_metrics(prism(),building)['reason'])
        bad = prism(); bad['triangles'].pop(); bad['semantics'].pop()
        self.assertEqual(q.mesh_metrics(bad,building)['reason'],'invalid_geometry')
        bad = prism(); bad['vertices'][0][2] = -.11
        self.assertEqual(q.mesh_metrics(bad,building)['reason'],'invalid_geometry')
        bad = prism(); bad['vertices'][0][0] = float('nan')
        self.assertEqual(q.mesh_metrics(bad,building)['reason'],'invalid_geometry')
        larger = dict(building,footprint={'type':'Polygon','coordinates':[[[0,0],[11,0],[11,10],[0,10],[0,0]]]})
        self.assertEqual(q.mesh_metrics(prism(),larger)['reason'],'roof_coverage_low')

    def test_detail_guard_at_025_boundary_and_spike_retry_at_005(self):
        q = load('quality')
        building = {'buildingId':'b','footprintHash':'h','heightM':10}
        base = {'mesh':prism(),'metrics':{'reason':None,'maeM':.5,'pitchedFraction':0.,'spikes':0,'validationSamples':50,'validationCoverage':1.},'name':'simplified'}
        reference = {'mesh':prism(True),'metrics':dict(base['metrics'],maeM=.249,pitchedFraction=1.),'name':'reference'}
        self.assertEqual(q.choose_candidates([base,reference],building)['selectedCandidate'],'reference')
        reference['metrics']['maeM'] = .251
        self.assertEqual(q.choose_candidates([base,reference],building)['selectedCandidate'],'simplified')
        base['metrics']['spikes'] = 1
        retry = {'mesh':prism(),'metrics':dict(base['metrics'],spikes=0,maeM=.55),'name':'retry'}
        self.assertEqual(q.choose_candidates([base,retry],building)['selectedCandidate'],'retry')
        retry['metrics']['maeM'] = .551
        self.assertEqual(q.choose_candidates([base,retry],building)['reason'],'spike_unresolved')

    def test_validation_sparse_never_becomes_zero_error_and_source_disagreement(self):
        q = load('quality')
        building = {'buildingId':'b','footprintHash':'h','footprint':{'type':'Polygon','coordinates':[[[0,0],[10,0],[10,10],[0,10],[0,0]]]},'heightM':3}
        self.assertEqual(q.mesh_metrics(prism(),building)['reason'],'source_height_disagreement')
        building['heightM'] = 10
        candidate = {'name':'simplified','mesh':prism(),'trainingCount':50}
        empty = np.empty(0,dtype=[('x','f8'),('y','f8'),('z','f8'),('sourceSha','U64'),('ordinal','u8')])
        result = q.select_candidate([candidate],empty,building,{})
        self.assertEqual(result['reason'],'validation_insufficient')
        self.assertIsNone(result['candidates'][0]['metrics']['maeM'])

    def test_triangle_limit_applies_before_clipping_and_landmark_has_explicit_larger_budget(self):
        q=load('quality')
        n=130
        ring=[[5+5*np.cos(a),5+5*np.sin(a)] for a in np.arange(n)*2*np.pi/n]
        vertices=[[*p,z] for z in [0,10] for p in ring]+[[5,5,0],[5,5,10]]
        triangles=[];semantics=[]
        for i in range(n):
            j=(i+1)%n
            triangles.extend([[2*n,j,i],[2*n+1,n+i,n+j],[i,j,n+j],[i,n+j,n+i]])
            semantics.extend(['GroundSurface','RoofSurface','WallSurface','WallSurface'])
        mesh={'vertices':vertices,'triangles':triangles,'semantics':semantics}
        b={'heightM':10,'footprint':{'type':'Polygon','coordinates':[ring+[ring[0]]]}}
        self.assertEqual(q.mesh_metrics(mesh,b)['reason'],'complexity_limit')
        self.assertIsNone(q.mesh_metrics(mesh,b,True)['reason'])

    def test_real_archived_corner_cap_is_detected_using_patch_area_and_adjacency(self):
        import json
        from pathlib import Path
        q=load('quality')
        root=Path(__file__).parents[2]/'test/fixtures/roofs'
        case=next(c for c in json.loads((root/'real-cases.json').read_text()) if c['label']=='corner-cap')
        original=json.loads((root/'original-cap.json').read_text())
        metrics=q.mesh_metrics(original['mesh'],case['building'])
        self.assertEqual(metrics['spikes'],1)
        self.assertGreater(metrics['maxHeightM'],13)

    def test_retry_for_reference_only_spike_cannot_bypass_005_error_budget(self):
        q=load('quality')
        building={'buildingId':'b','footprintHash':'h','heightM':10}
        failed={'name':'simplified','mesh':None,'metrics':{'reason':'fit_failed','maeM':None,'pitchedFraction':None,'spikes':0}}
        reference={'name':'reference','mesh':prism(),'metrics':{'reason':None,'maeM':.5,'pitchedFraction':0,'spikes':1}}
        retry={'name':'retry','mesh':prism(),'metrics':{'reason':None,'maeM':.551,'pitchedFraction':0,'spikes':0}}
        self.assertEqual(q.choose_candidates([failed,reference,retry],building)['reason'],'spike_unresolved')
