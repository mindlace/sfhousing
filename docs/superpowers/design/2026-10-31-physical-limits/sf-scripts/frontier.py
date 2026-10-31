import sys, csv
import numpy as np
rows = list(csv.DictReader(open(sys.argv[1])))
def col(n, t=float):
    return np.array([t(r[n]) for r in rows])
M = 1 / 0.3048
wid = col('wid_m') * M; ln = col('len_m') * M; area = col('area_m2') * M * M
hm = col('h_med'); year = col('year', int); multi = col('multipoly', int)
fpw = col('fp_wid_m') * M; fpl = col('fp_len_m') * M; fpa = col('fp_area') * M * M
S = np.where(hm > 4.5, np.floor((hm - 4.5) / 3.1 + 0.5) + 1, 1).astype(int)
clean = (multi == 0) & (fpw <= 1.15 * wid + 3) & (fpl <= 1.15 * ln + 3)
cov = fpa / area
print('clean n', clean.sum())
for name, m in (('a', clean), ('b', clean & (year > 0) & (year < 1960)), ('b-no1900', clean & (year > 0) & (year < 1960) & (year != 1900)), ('post1960', clean & (year >= 1960))):
    print('== cut', name, m.sum())
    for k in (4, 5, 6, 8, 10, 13, 20, 30):
        mm = m & (S >= k)
        if mm.sum() < 5:
            print('  >=%d stories: n=%d' % (k, mm.sum())); continue
        print('  >=%d stories: n=%d  width ft p1/p5/p25/p50 = %s  area ft2 p1/p5/p25/p50 = %s  min w %.0f min area %.0f' % (
          k, mm.sum(), np.round(np.percentile(wid[mm], [1, 5, 25, 50])).astype(int), np.round(np.percentile(area[mm], [1, 5, 25, 50])).astype(int), wid[mm].min(), area[mm].min()))
# fraction of sites >=k by width bin
E = [0, 20, 30, 40, 60, 80, 120, 200, 1e9]
print('share of clean sites with >=k stories by width bin (a) and (b)')
for name, m in (('a', clean), ('b', clean & (year > 0) & (year < 1960))):
    for k in (5, 8, 13, 20):
        print(name, k, ['%.2f%%' % (100 * np.mean(S[m & (wid >= E[i]) & (wid < E[i + 1])] >= k)) if (m & (wid >= E[i]) & (wid < E[i + 1])).sum() else '-' for i in range(8)])
# narrow tall list
mm = np.where(clean & (S >= 10) & (wid < 60))[0]
print('narrow tall (S>=10, wid<60):', len(mm))
for i in mm[:25]:
    print(rows[i]['lot_id'], S[i], 'wid %.0f len %.0f area %.0f fp %.0fx%.0f year %d nlots %s' % (wid[i], ln[i], area[i], fpw[i], fpl[i], year[i], rows[i]['nlots']))
# tower footprint vs lot coverage
t = clean & (S >= 13)
print('S>=13: footprint/lot coverage p10/50/90', np.round(np.percentile(cov[t], [10, 50, 90]), 2), ' lot width/footprint width p10/50', np.round(np.percentile(wid[t] / np.maximum(fpw[t], 1), [10, 50]), 2))
