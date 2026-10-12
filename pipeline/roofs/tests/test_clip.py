import unittest
import numpy as np
from shapely.geometry import box, mapping, Polygon, MultiPolygon
from test_filter import load
from test_quality import prism


def piece(geom, parcel='a'):
    return {'buildingId':'b', 'parcelId':parcel, 'geometry':mapping(geom)}


def volume(mesh):
    v=np.array(mesh['vertices']); t=np.array(mesh['triangles']); a=v[t]-v[0]
    edges={}
    for tri in t:
        for x,y in zip(tri,np.roll(tri,-1)): edges[(x,y)]=edges.get((x,y),0)+1
    assert all(n==1 and edges.get((y,x))==1 for (x,y),n in edges.items())
    return np.einsum('ij,ij->i',a[:,0],np.cross(a[:,1],a[:,2])).sum()/6


class ClipTests(unittest.TestCase):
    def test_sloped_solid_has_closed_matching_cut_walls_and_unmatched_piece(self):
        c=load('clip')
        results=c.clip_building(prism(True),[piece(box(0,0,5,10)),piece(box(5,0,10,10),None)])
        self.assertEqual([p['reason'] for p in results],[None,None])
        self.assertAlmostEqual(sum(volume(p['mesh']) for p in results),1100)
        for p in results:
            cut=[v[2] for v in p['mesh']['vertices'] if abs(v[0]-5)<1e-7]
            self.assertAlmostEqual(max(cut),11)
            self.assertAlmostEqual(min(cut),0)
        self.assertNotEqual(results[0]['pieceId'],results[1]['pieceId'])

    def test_holes_multipolygons_and_coplanar_boundaries_preserve_volume(self):
        c=load('clip')
        hole=Polygon(box(0,0,10,10).exterior.coords,[box(3,3,7,7).exterior.coords])
        multi=MultiPolygon([box(0,0,2,10),box(8,0,10,10)])
        for geom,want in [(hole,840),(multi,400),(box(0,0,10,10),1000)]:
            p=c.clip_building(prism(),[piece(geom)])[0]
            self.assertIsNone(p['reason'])
            self.assertAlmostEqual(volume(p['mesh']),want,places=5)

    def test_invalid_piece_isolated_and_open_parent_never_repaired(self):
        c=load('clip')
        ps=[piece(box(0,0,5,10)),piece(Polygon([(0,0),(5,5),(0,6),(4,0),(0,0)]),'bad')]
        results=c.clip_building(prism(),ps)
        by_parcel={p['parcelId']:p for p in results}
        self.assertIsNone(by_parcel['a']['reason'])
        self.assertEqual(by_parcel['bad']['reason'],'parcel_clip_failed')
        mesh=prism(); mesh['triangles'].pop(); mesh['semantics'].pop()
        self.assertEqual(c.clip_building(mesh,ps[:1])[0]['reason'],'parcel_clip_failed')

    def test_identity_and_mesh_ignore_ring_and_input_order(self):
        c=load('clip'); g=load('geometry')
        a=mapping(box(0,0,5,10)); ring=list(a['coordinates'][0][:-1]); ring=ring[2:]+ring[:2]; ring.reverse(); ring.append(ring[0])
        b={'type':'Polygon','coordinates':[ring]}
        self.assertEqual(g.make_piece_id('b','a',a),g.make_piece_id('b','a',b))
        self.assertRegex(g.make_piece_id('b','a',a),r'^p-[a-f0-9]{24}$')
        left=piece(box(0,0,5,10)); right=piece(box(5,0,10,10),'z')
        first=c.clip_building(prism(True),[left,right])
        second=c.clip_building(prism(True),[right,dict(left,geometry=b)])
        self.assertEqual(first,second)
        multi=MultiPolygon([box(0,0,2,10),box(8,0,10,10)])
        reversed_multi=MultiPolygon(list(multi.geoms)[::-1])
        self.assertEqual(g.make_piece_id('b',None,mapping(multi)),g.make_piece_id('b',None,mapping(reversed_multi)))
        self.assertNotEqual(g.make_piece_id('b',None,a),g.make_piece_id('b','unmatched',a))
        original=prism(True)
        n=len(original['vertices'])
        shuffled={'vertices':original['vertices'][::-1],'triangles':[[n-1-i for i in tri] for tri in original['triangles'][::-1]],'semantics':original['semantics'][::-1]}
        self.assertEqual(first,c.clip_building(shuffled,[right,left]))

    def test_cut_uses_retained_boundary_without_identity_snapping(self):
        c=load('clip')
        out=c.clip_building(prism(True),[piece(box(0,0,5.0004,10))])[0]
        self.assertIsNone(out['reason'])
        self.assertAlmostEqual(max(v[0] for v in out['mesh']['vertices']),5.0004,places=8)
        self.assertAlmostEqual(volume(out['mesh']),525.04400016,places=6)
