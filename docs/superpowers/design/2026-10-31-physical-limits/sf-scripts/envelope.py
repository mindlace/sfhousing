import sys, csv
import numpy as np
rows = list(csv.DictReader(open(sys.argv[1])))
def col(n, t=float):
    return np.array([t(r[n]) for r in rows])
M = 1 / 0.3048
wid = col('wid_m') * M; ln = col('len_m') * M; area = col('area_m2') * M * M
hm = col('h_med'); year = col('year', int); multi = col('multipoly', int)
fpw = col('fp_wid_m') * M; fpl = col('fp_len_m') * M
S = np.where(hm > 4.5, np.floor((hm - 4.5) / 3.1 + 0.5) + 1, 1).astype(int)
clean = (multi == 0) & (fpw <= 1.15 * wid + 3) & (fpl <= 1.15 * ln + 3)
E = [0, 20, 30, 40, 60, 80, 120, 200, 1e9]
L = ['<20', '20-30', '30-40', '40-60', '60-80', '80-120', '120-200', '200+']
for name, m in (('a', clean), ('b', clean & (year > 0) & (year < 1960))):
    print('cut', name, ' bin | n | p99 | p99.5 | p99.9 | max | H/w_lot at p99.9 | ... (stories at p99.9; H/w = (stories*3.1)/(wid m))')
    for i in range(8):
        mm = m & (wid >= E[i]) & (wid < E[i + 1])
        x = S[mm]
        hw = (S[mm] * 3.1) / (wid[mm] * 0.3048)
        print(L[i], mm.sum(), [int(np.percentile(x, q, method='higher')) for q in (99, 99.5, 99.9)], x.max(), 'H/w p99 %.1f p99.9 %.1f max %.1f' % tuple(np.percentile(hw, [99, 99.9, 100])))
# by area
AE = [0, 2000, 3000, 5000, 10000, 20000, 40000, 1e12]
AL = ['<2k', '2-3k', '3-5k', '5-10k', '10-20k', '20-40k', '40k+']
for name, m in (('a', clean), ('b', clean & (year > 0) & (year < 1960))):
    print('area cut', name)
    for i in range(7):
        mm = m & (area >= AE[i]) & (area < AE[i + 1])
        x = S[mm]
        print(AL[i], mm.sum(), [int(np.percentile(x, q, method='higher')) for q in (99, 99.5, 99.9)], x.max())
# 2D finer: width bins x area bins at p99.5 (a) with n>=100
print('2D p99.5 (a) wid x area, n>=60 else -')
print('   ', AL)
for i in range(8):
    r = []
    for j in range(7):
        mm = clean & (wid >= E[i]) & (wid < E[i + 1]) & (area >= AE[j]) & (area < AE[j + 1])
        r.append('%d/%d(n%d)' % (np.percentile(S[mm], 99.5, method='higher'), np.percentile(S[mm], 99.9, method='higher'), mm.sum()) if mm.sum() >= 60 else '-')
    print(L[i], r)
print('2D p99.5 (b)')
for i in range(8):
    r = []
    for j in range(7):
        mm = clean & (year > 0) & (year < 1960) & (wid >= E[i]) & (wid < E[i + 1]) & (area >= AE[j]) & (area < AE[j + 1])
        r.append('%d/%d(n%d)' % (np.percentile(S[mm], 99.5, method='higher'), np.percentile(S[mm], 99.9, method='higher'), mm.sum()) if mm.sum() >= 60 else '-')
    print(L[i], r)
# depth effect: for width 40-80 ft, by depth bin
print('depth effect, width 40-80, area 5-20k, S p99/p99.9 by len')
for lo, hi in ((0, 90), (90, 120), (120, 160), (160, 250)):
    mm = clean & (wid >= 40) & (wid < 80) & (ln >= lo) & (ln < hi)
    if mm.sum() > 30:
        print(lo, hi, mm.sum(), [int(np.percentile(S[mm], q, method='higher')) for q in (50, 99, 99.9)], S[mm].max())
