import hashlib
import json
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import laspy
from geometry import canonical_geometry, footprint_hash, load_points

class InputsTest(unittest.TestCase):
    def test_canonical_rings_snap_rotate_and_normalize_negative_zero(self):
        a = {"type":"Polygon","coordinates":[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}
        b = {"type":"Polygon","coordinates":[[[2.0001,2],[2,0],[-0.0001,0],[0,2],[2.0001,2]]]}
        self.assertEqual(canonical_geometry(a), canonical_geometry(b))
        self.assertNotIn('-0', json.dumps(canonical_geometry(b)))
        self.assertEqual(footprint_hash(a), footprint_hash(b))

    def test_holes_and_multipolygon_order_do_not_change_hash(self):
        outer = [[0,0],[10,0],[10,10],[0,10],[0,0]]
        h1 = [[1,1],[1,2],[2,2],[2,1],[1,1]]
        h2 = [[4,4],[4,5],[5,5],[5,4],[4,4]]
        a = {"type":"MultiPolygon","coordinates":[[outer,h1,h2],[outer]]}
        b = {"type":"MultiPolygon","coordinates":[[outer],[outer,h2[::-1],h1[::-1]]]}
        self.assertEqual(footprint_hash(a),footprint_hash(b))

    def test_original_ordinals_survive_crop_and_source_order(self):
        with tempfile.TemporaryDirectory() as d:
            sources = []
            for name, xx in [('a',[1000,0,49,51]),('b',[1001,1,48,52])]:
                las = laspy.LasData(laspy.LasHeader(point_format=6,version='1.4'))
                las.x = xx; las.y = [0]*4; las.z = [2]*4
                las.classification = np.array([1,2,1,1],dtype=np.uint8)
                path = Path(d)/f'{name}.laz'; las.write(path)
                sources.append({'kind':'lidar','path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                    'horizontalCrs':'EPSG:7131','supportBufferM':50})
            job = {'sources':sources,'buildings':[{'buildingId':'b','bbox':[0,0,1,1]}]}
            points = load_points(job)['b']
            self.assertEqual(sorted(points['ordinal'].tolist()),[1,1,2,2,3])
            self.assertEqual(sorted(points['x'].tolist()),[0,1,48,49,51])
            job['sources'].reverse()
            np.testing.assert_array_equal(points,load_points(job)['b'])
            for source in sources:
                source['coverage'] = [{'id':'elsewhere','bbox':[0,0,0.00001,0.00001]}]
            self.assertEqual(len(load_points(job)['b']),0)
            Path(sources[0]['path']).write_bytes(b'bad')
            with self.assertRaisesRegex(ValueError,'sha256 mismatch'):
                load_points(job)

    def test_sf_physical_50m_support_boundary_survives_mercator_source_crop(self):
        from pyproj import Transformer
        tx = Transformer.from_crs('EPSG:4326','EPSG:7131',always_xy=True)
        x,y = tx.transform(-122.413,37.754)
        mercator = Transformer.from_crs('EPSG:7131','EPSG:3857',always_xy=True)
        xx,yy = mercator.transform([x-49.9,x-50.1,x+1],[y,y,y])
        with tempfile.TemporaryDirectory() as d:
            las = laspy.LasData(laspy.LasHeader(point_format=6,version='1.4'))
            las.header.scales = [.001,.001,.001]
            las.header.offsets = [xx[0],yy[0],0]
            las.x = np.array(xx); las.y = np.array(yy); las.z = np.array([10,10,10])
            las.classification = np.array([2,2,1],dtype=np.uint8)
            path = Path(d)/'sf.laz'; las.write(path)
            source = {'kind':'lidar','path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'horizontalCrs':'EPSG:3857','supportBufferM':50,'coverage':[{'id':'sf','bbox':[-122.413,37.754,-122.412,37.755]}]}
            buildings = [{'buildingId':'inside','bbox':[x,y,x+10,y+10]}]+[{'buildingId':f'far-{i}','bbox':[0,0,1,1]} for i in range(100)]
            points = load_points({'sources':[source],'buildings':buildings})
            self.assertEqual(points['inside']['ordinal'].tolist(),[0,2])
            self.assertTrue(all(len(points[b['buildingId']])==0 for b in buildings[1:]))
