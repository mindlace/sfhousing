# Build per-site table: join footprints to parcels, merge lots linked by a building, geometry metrics.
import sys, json, glob, csv
import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import shape

raw, pbnpz, out = sys.argv[1], sys.argv[2], sys.argv[3]
LAT0 = 37.76
KX = 6371000.0 * np.cos(np.radians(LAT0)) * np.pi / 180.0
KY = 6371000.0 * np.pi / 180.0

def proj(geom):
    return shapely.transform(geom, lambda a: np.column_stack(((a[:, 0] + 122.44) * KX, (a[:, 1] - LAT0) * KY)))

def load(pattern):
    rows = []
    for f in sorted(glob.glob(raw + '/' + pattern)):
        rows.extend(json.load(open(f)))
    return rows

par = load('par_*.json')
print('parcel rows', len(par))
lots = dict()   # mapblklot -> geom (largest area if dup)
blk2map = dict()
for r in par:
    if not r.get('shape'):
        continue
    g = proj(shape(r['shape']))
    if g.is_empty:
        continue
    m = r['mapblklot']
    blk2map[r['blklot']] = m
    if m not in lots or g.area > lots[m].area:
        lots[m] = g
keys = list(lots.keys())
lg = shapely.make_valid(np.array([lots[k] for k in keys], dtype=object))
print('lots (unique mapblklot)', len(keys))
tree = STRtree(lg)

fp = load('fp_*.json')
print('footprint rows', len(fp))
fgeom = []; fh = []; fpk = []; fid = []
for r in fp:
    if not r.get('shape') or r.get('hgt_median_m') is None:
        continue
    fgeom.append(proj(shape(r['shape'])))
    fh.append(float(r['hgt_median_m']))
    fpk.append(float(r.get('hgt_maxcm', 0) or 0) / 100.0)
    fid.append(r['sf16_bldgid'])
fgeom = shapely.make_valid(np.array(fgeom, dtype=object))
fh = np.array(fh); fpk = np.array(fpk)
farea = shapely.area(fgeom)
print('footprints with height', len(fgeom))

ii, jj = tree.query(fgeom, predicate='intersects')   # ii footprint idx, jj lot idx
inter = shapely.area(shapely.intersection(fgeom[ii], lg[jj]))
share = inter / farea[ii]

# union-find over lots
parent = np.arange(len(keys))
def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x
def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        parent[rb] = ra

MIN_FP = 30.0
LINK = 0.2
order = np.argsort(ii, kind='stable')
ii, jj, share = ii[order], jj[order], share[order]
starts = np.searchsorted(ii, np.arange(len(fgeom) + 1))
bld_lot = -np.ones(len(fgeom), dtype=int)     # primary lot of each building
bld_nlots = np.zeros(len(fgeom), dtype=int)
bld_share = np.zeros(len(fgeom))
for b in range(len(fgeom)):
    s, e = starts[b], starts[b + 1]
    if e == s or farea[b] < MIN_FP:
        continue
    sh = share[s:e]; lj = jj[s:e]
    if sh.sum() < 0.5:
        continue
    k = np.argmax(sh)
    bld_lot[b] = lj[k]; bld_share[b] = sh[k]
    linked = lj[sh >= LINK]
    if len(linked) == 0:
        linked = np.array([lj[k]])
    bld_nlots[b] = len(linked)
    for l in linked[1:]:
        union(linked[0], l)

root = np.array([find(i) for i in range(len(keys))])
sites = dict()   # root -> list of lot idx
for i, r in enumerate(root):
    sites.setdefault(r, []).append(i)

# roll
roll = load('roll_*.json')
yr = dict(); stor = dict()
for r in roll:
    p = r['parcel_number']
    y = int(float(r.get('year_property_built') or 0))
    if y > 0 and (p not in yr or y < yr[p]):
        yr[p] = y
    stor[p] = max(stor.get(p, 0), float(r.get('number_of_stories') or 0))
# condo-lot years: map via blklot -> mapblklot (min nonzero)
for bk, mk in blk2map.items():
    if bk in yr and (mk not in yr or yr[bk] < yr[mk]):
        yr[mk] = yr[bk]
    if bk in stor and stor[bk] > stor.get(mk, 0):
        stor[mk] = stor[bk]

pb = np.load(pbnpz)
pbi = dict((s, i) for i, s in enumerate(pb['id']))

def pca_dims(poly):
    ring = np.array(poly.exterior.coords)[:-1]
    if len(ring) < 3:
        return 0, 0
    c = np.array(poly.centroid.coords[0])
    p = ring - c
    q = np.roll(p, -1, axis=0)
    cr = p[:, 0] * q[:, 1] - q[:, 0] * p[:, 1]
    sxx = np.sum(cr * (p[:, 0] ** 2 + p[:, 0] * q[:, 0] + q[:, 0] ** 2)) / 12
    syy = np.sum(cr * (p[:, 1] ** 2 + p[:, 1] * q[:, 1] + q[:, 1] ** 2)) / 12
    sxy = np.sum(cr * (p[:, 0] * q[:, 1] + 2 * p[:, 0] * p[:, 1] + 2 * q[:, 0] * q[:, 1] + q[:, 0] * p[:, 1])) / 24
    if sxx + syy < 0:
        sxx, syy, sxy = -sxx, -syy, -sxy
    half = (sxx - syy) / 2
    disc = np.hypot(half, sxy)
    if half >= 0:
        ux, uy = half + disc, sxy
    else:
        ux, uy = sxy, disc - half
    n = np.hypot(ux, uy)
    if n == 0:
        ux, uy, n = 1.0, 0.0, 1.0
    u = np.array([ux / n, uy / n]); v = np.array([-u[1], u[0]])
    a = ring @ u; b = ring @ v
    return a.max() - a.min(), b.max() - b.min()

# per-site tallest building
best = dict()   # root -> building idx (tallest median)
nb = dict()
for b in range(len(fgeom)):
    l = bld_lot[b]
    if l < 0:
        continue
    r = root[l]
    nb[r] = nb.get(r, 0) + 1
    if r not in best or fh[b] > fh[best[r]]:
        best[r] = b
print('sites with buildings', len(best))

hdr = ['site', 'nlots', 'nbld', 'area_m2', 'len_m', 'wid_m', 'mrr_min_m', 'h_med', 'h_peak', 'fp_area', 'fp_wid_m', 'fp_len_m',
       'span_lots', 'share_primary', 'year', 'lot_id', 'base_st', 'env_st', 'pb_year', 'pb_imputed', 'multipoly', 'roll_stories', 'district']
w = csv.writer(open(out, 'w'))
w.writerow(hdr)
for r, b in best.items():
    members = sites[r]
    geoms = lg[members]
    if len(members) == 1:
        g = geoms[0]
    else:
        g = shapely.union_all(geoms)
    multi = 0
    if g.geom_type != 'Polygon':
        parts = [x for x in getattr(g, 'geoms', []) if x.geom_type == 'Polygon']
        if not parts:
            continue
        g = max(parts, key=lambda x: x.area)
        multi = 1 if sum(1 for x in parts if x.area > 0.05 * g.area) > 1 else 0
    L, W = pca_dims(g)
    if L < W:
        L, W = W, L
    mrr = shapely.minimum_rotated_rectangle(g)
    mc = np.array(mrr.exterior.coords)
    e = np.hypot(*(mc[1:3] - mc[0:2]).T)
    mrr_min = float(min(e))
    fgb = fgeom[b]
    if fgb.geom_type != 'Polygon':
        pp = [x for x in getattr(fgb, 'geoms', []) if x.geom_type == 'Polygon']
        fgb = max(pp, key=lambda x: x.area) if pp else None
    if fgb is not None and fgb.area > 0:
        fl, fw = pca_dims(fgb)
        if fl < fw:
            fl, fw = fw, fl
    else:
        fl = fw = 0
    lot = keys[bld_lot[b]]
    y = yr.get(lot, 0)
    i = pbi.get(lot)
    if i is None:
        i = pbi.get(lot.lstrip('0')) 
    if i is None:
        bs = es = pyr = pim = -1; dist = ''
    else:
        bs = int(pb['base'][i]); es = int(pb['env'][i]); pyr = int(pb['year'][i]); pim = int(pb['imputed'][i]) & 1; dist = str(pb['district'][i])
    w.writerow([lot, len(members), nb[r], round(g.area, 1), round(L, 2), round(W, 2), round(mrr_min, 2), fh[b], fpk[b], round(farea[b], 1),
                round(fw, 2), round(fl, 2), bld_nlots[b], round(bld_share[b], 2), y, lot, bs, es, pyr, pim, multi, stor.get(lot, 0), dist])
print('done')
print('buildings assigned', int((bld_lot >= 0).sum()), 'spanning >1 lot (>=20% each)', int((bld_nlots > 1).sum()))
