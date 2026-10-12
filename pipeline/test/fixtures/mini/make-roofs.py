"""Deterministic synthetic original returns; production roofer generates the published meshes."""
from pathlib import Path
import datetime,json
import laspy
import numpy as np
from pyproj import Transformer
from shapely.geometry import shape,Point
from shapely.ops import transform
root=Path(__file__).parent
features=json.loads((root/'raw/overture-buildings.page-000.geojson').read_text())['features']
tx=Transformer.from_crs('EPSG:4326','EPSG:7131',always_xy=True)
points=[]
for feature in features:
    if feature['properties']['id'] not in ('b01','b10'):continue
    poly=transform(tx.transform,shape(feature['geometry']))
    w,s,e,n=poly.bounds
    for x in np.arange(w+.05,e,.2):
        for y in np.arange(s+.05,n,.2):
            if poly.contains(Point(x,y)):
                points.append((x,y,3+feature['properties']['height']-1+(x-w)/(e-w),1))
    for x in np.arange(w-4,e+4,.5):
        for y in np.arange(s-4,n+4,.5):
            if not poly.contains(Point(x,y)):points.append((x,y,3,2))
header=laspy.LasHeader(point_format=6,version='1.4')
header.scales=[.001,.001,.001];header.offsets=[50000,25000,0]
header.creation_date=datetime.date(2026,10,10);header.generating_software='sfhousing synthetic fixture'
las=laspy.LasData(header);p=np.array(points)
las.x=p[:,0];las.y=p[:,1];las.z=p[:,2];las.classification=p[:,3].astype('u1')
las.write(root/'raw/roof-lidar.laz')
