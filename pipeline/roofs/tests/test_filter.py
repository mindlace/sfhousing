import importlib.util
from pathlib import Path
import unittest
import numpy as np
from shapely.geometry import box


def load(name):
    spec = importlib.util.spec_from_file_location('roof_'+name, Path(__file__).parents[1]/(name+'.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class FilterTests(unittest.TestCase):
    def test_split_uses_sha_digest_and_original_ordinal_not_batch_position(self):
        f = load('filter')
        sha = '0'*64
        ordinals = np.array([0,1,2,3,4,5,6,7,8,9], dtype=np.uint64)
        self.assertEqual(f.validation_partition(sha, ordinals).tolist(), [False,False,False,True,False,False,True,False,True,True])
        self.assertEqual(f.validation_partition(sha, ordinals[::-1]).tolist(), [True,True,False,True,False,False,True,False,False,False])

    def test_ground_uses_fifth_percentile_then_nearest_50m_and_never_roof_minimum(self):
        f = load('filter')
        p = np.array([(1.,1.,10.,2), (2.,2.,30.,2), (1.,1.,100.,1)], dtype=[('x','f8'),('y','f8'),('z','f8'),('classification','u1')])
        self.assertEqual(f.estimate_ground(p, box(0,0,3,3)).groundM, 11.)
        p['x'][:2] = [30,70]
        self.assertEqual(f.estimate_ground(p, box(0,0,3,3)).groundM, 10.)
        p['x'][:2] = [70,80]
        self.assertIsNone(f.estimate_ground(p, box(0,0,3,3)).groundM)

    def test_absent_image_sparse_pca_and_outside_raster_invent_no_canopy(self):
        f = load('filter')
        p = np.array([(100.,100.,20.,1),(100.,100.,23.,1),(100.,100.,0.,2)], dtype=[('x','f8'),('y','f8'),('z','f8'),('classification','u1')])
        config = {'cellM':.5}
        self.assertFalse(f.vegetation_mask(p, None, None, config).rejected.any())
        image = np.full((4,4,3), [0,255,0], dtype=np.uint8)
        self.assertFalse(f.vegetation_mask(p, image, {'left':0,'top':4,'pixelM':1,'crs':'EPSG:7131'}, config).rejected.any())
        p['x'] = 1; p['y'] = 1
        self.assertFalse(f.vegetation_mask(p[:2], image, {'left':0,'top':4,'pixelM':1,'crs':'EPSG:7131'}, config).rejected.any())

    def test_synthetic_rgb_roughness_height_conjunction_preserves_ground_and_validation_independence(self):
        f = load('filter')
        dtype=[('x','f8'),('y','f8'),('z','f8'),('classification','u1')]
        smooth=[(x,y,5.,1) for x in np.arange(0,4,.1) for y in np.arange(0,4,.1)]
        # Deterministic volumetric canopy: RGB alone cannot remove this support cloud.
        canopy=[(5+x*.02,1+y*.02,9+z*.2,1) for x in range(10) for y in range(10) for z in range(15)]
        p=np.array(smooth+canopy+[(5.1,1.1,0,2)],dtype=dtype)
        rgb=np.zeros((100,100,3),dtype='u1');rgb[:]=[80,80,80];rgb[:,50:70]=[20,150,20]
        tf={'left':0,'top':8,'pixelM':.1,'crs':'EPSG:7131'}
        result=f.vegetation_mask(p,rgb,tf,{'cellM':.5})
        self.assertGreater(result.rejected.sum(),100)
        self.assertFalse(result.rejected[-1])
        self.assertFalse(result.rejected[:len(smooth)].any())
        validation=np.array([(5.1,1.1,10,1),(2,2,5,1)],dtype=dtype)
        before=f.apply_cells(validation,result.cells)
        validation['z']=[100,-100]
        np.testing.assert_array_equal(before,f.apply_cells(validation,result.cells))
        gray=rgb.copy();gray[:]=80
        self.assertFalse(f.vegetation_mask(p,gray,tf,{'cellM':.5}).rejected.any())
        low=p.copy();low['z'][len(smooth):-1]-=6
        self.assertFalse(f.vegetation_mask(low,rgb,tf,{'cellM':.5}).rejected.any())

    def test_boundary_straddling_cell_never_borrows_covered_pixels_for_uncovered_returns(self):
        f=load('filter')
        dtype=[('x','f8'),('y','f8'),('z','f8'),('classification','u1')]
        smooth=[(x,y,5.,1) for x in np.arange(0,4,.1) for y in np.arange(0,4,.1)]
        canopy=[(5+x*.02,1+y*.02,9+z*.2,1) for x in range(25) for y in range(10) for z in range(15)]
        points=np.array(smooth+canopy,dtype=dtype)
        rgb=np.full((100,53,3),80,dtype='u1');rgb[:,50:]=[20,150,20]
        tf={'left':0,'top':8,'pixelM':.1,'crs':'EPSG:7131'}
        result=f.vegetation_mask(points,rgb,tf,{'cellM':.5})
        uncovered=points['x']>=5.3
        self.assertEqual(int(uncovered.sum()),1500)
        self.assertFalse(result.rejected[uncovered].any())
        # Discard the entire partially covered cell so validation cannot borrow it either.
        self.assertFalse(result.rejected[len(smooth):].any())
        validation=np.array([(5.4,1.1,10,1),(5.1,1.1,10,1)],dtype=dtype)
        self.assertFalse(f.apply_cells(validation,result.cells).any())
        # The training sample may miss the uncovered portion entirely. Its cells
        # must still be safe for unseen validation returns beyond the raster edge.
        covered_only=f.vegetation_mask(points[~uncovered],rgb,tf,{'cellM':.5})
        self.assertFalse(f.apply_cells(validation,covered_only.cells).any())
        self.assertIn('aerial_partial_coverage',result.diagnostics)
        self.assertEqual(result.flags,['aerial_missing'])

    def test_missing_smooth_support_retains_internal_diagnostic_without_unknown_flag(self):
        f=load('filter')
        points=np.array([(1.,1.,5.,1),(2.,1.,5.,1),(1.,2.,5.,1),(1.,1.,6.,1)],dtype=[('x','f8'),('y','f8'),('z','f8'),('classification','u1')])
        image=np.full((100,100,3),[20,150,20],dtype='u1')
        result=f.vegetation_mask(points,image,{'left':0,'top':8,'pixelM':.1,'crs':'EPSG:7131'},{'cellM':.5})
        self.assertFalse(result.rejected.any())
        self.assertEqual(result.flags,['vegetation_ambiguous'])
        self.assertEqual(result.diagnostics,['smooth_support_missing'])
