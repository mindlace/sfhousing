"""Closed-solid parcel intersection. No repairs or synthetic replacement roofs."""
from collections import Counter
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import numpy as np
import manifold3d as m
from shapely.geometry import shape, mapping, Polygon
from shapely import normalize, orient_polygons
from shapely.ops import unary_union
from geometry import make_piece_id


def checked_solid(mesh):
    v=np.asarray(mesh['vertices'],dtype=np.float64)
    t=np.asarray(mesh['triangles'])
    if v.ndim!=2 or v.shape[1]!=3 or not np.isfinite(v).all() or t.ndim!=2 or t.shape[1]!=3 or not len(t) or not np.issubdtype(t.dtype,np.integer) or t.min()<0 or t.max()>=len(v):
        raise ValueError('invalid mesh arrays')
    edges=Counter((int(a),int(b)) for tri in t for a,b in zip(tri,np.roll(tri,-1)))
    if any(n!=1 or edges[(b,a)]!=1 for (a,b),n in edges.items()):
        raise ValueError('not a closed oriented manifold')
    normals=np.cross(v[t[:,1]]-v[t[:,0]],v[t[:,2]]-v[t[:,0]])
    if (np.linalg.norm(normals,axis=1)<=1e-10).any(): raise ValueError('degenerate face')
    solid=m.Manifold(m.Mesh64(v,np.asarray(t,dtype=np.uint64)))
    if solid.status()!=m.Error.NoError or solid.is_empty() or solid.volume()<=0:
        raise ValueError('invalid solid')
    return solid


def ordered_mesh(solid):
    raw=solid.to_mesh64()
    vertices=np.asarray(raw.vert_properties)[:,:3]
    # Stable vertex and oriented face order, independent of Boolean traversal.
    order=sorted(range(len(vertices)),key=lambda i:tuple(vertices[i]))
    inverse={old:new for new,old in enumerate(order)}
    triangles=[]
    for face in raw.tri_verts:
        tri=[inverse[int(i)] for i in face]
        triangles.append(min(tri[k:]+tri[:k] for k in range(3)))
    triangles.sort()
    vertices=vertices[order]
    semantics=[]
    for a,b,c in triangles:
        nz=np.cross(vertices[b]-vertices[a],vertices[c]-vertices[a])[2]
        semantics.append('RoofSurface' if nz>1e-9 else 'GroundSurface' if nz<-1e-9 else 'WallSurface')
    mesh={'vertices':vertices.tolist(),'triangles':triangles,'semantics':semantics}
    checked_solid(mesh)
    return mesh


def clip_building(mesh:dict,pieces:list[dict])->list[dict]:
    try:
        solid=checked_solid(mesh)
        z=np.asarray(mesh['vertices'])[:,2]
        low,high=float(z.min())-1,float(z.max())+1
    except (ValueError,TypeError,KeyError,RuntimeError):
        solid=None
    results=[]
    for piece in pieces:
        result=dict(piece,geometry=mapping(orient_polygons(normalize(shape(piece['geometry'])))),pieceId=make_piece_id(piece['buildingId'],piece['parcelId'],piece['geometry']),mesh=None,reason='parcel_clip_failed')
        try:
            geom=shape(piece['geometry'])
            if solid is None or not geom.is_valid or geom.is_empty or geom.area<=0:
                raise ValueError('invalid clipping geometry')
            # Ordering is canonical, but the Boolean uses exact retained parcel coordinates.
            canonical=result['geometry']
            parts=[canonical['coordinates']] if canonical['type']=='Polygon' else canonical['coordinates']
            contours=[np.asarray(ring[:-1],dtype=np.float64) for part in parts for ring in part]
            cutter=m.CrossSection(contours,m.FillRule.Positive).extrude(high-low).translate((0,0,low))
            clipped=solid ^ cutter
            if clipped.status()!=m.Error.NoError or clipped.is_empty() or clipped.volume()<=0:
                raise ValueError('empty intersection')
            out=ordered_mesh(clipped)
            v=np.asarray(out['vertices'])
            roof=unary_union([Polygon(v[tri,:2]) for tri,kind in zip(out['triangles'],out['semantics']) if kind=='RoofSurface'])
            if roof.intersection(geom).area/geom.area<.98 or roof.difference(geom.buffer(.001)).area>max(.01,geom.area*.001):
                raise ValueError('piece coverage lost')
            result.update(mesh=out,reason=None)
        except (ValueError,TypeError,KeyError,RuntimeError):
            pass
        results.append(result)
    return sorted(results,key=lambda p:p['pieceId'])
