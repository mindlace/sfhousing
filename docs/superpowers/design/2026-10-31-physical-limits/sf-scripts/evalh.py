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
def capA(A):
    k = A / 1000.0
    return np.where(k <= 15, 2.4 * k, np.where(k <= 30, 36 + 0.9 * (k - 15), 49.5 + 0.5 * (k - 30)))
def cap(w, A):
    return np.minimum(70, np.maximum(5, np.floor(np.minimum(0.3 * w, capA(A)))))
H = cap(wid, area)
E = [0, 20, 30, 40, 60, 80, 120, 200, 1e9]
L = ['<20', '20-30', '30-40', '40-60', '60-80', '80-120', '120-200', '200+']
for name, m in (('a', clean), ('b', clean & (year > 0) & (year < 1960)), ('post1960', clean & (year >= 1960))):
    print(name, 'overall exceed %.3f%%' % (100 * np.mean(S[m] > H[m])))
    print('  by width:', ['%s %.2f%%' % (L[i], 100 * np.mean(S[m & (wid >= E[i]) & (wid < E[i + 1])] > H[m & (wid >= E[i]) & (wid < E[i + 1])])) for i in range(8)])
    print('  mean of cap/ p99 ratio not computed')
print('reference lots: cap, and p99/p99.9 of neighbours (a)')
for (w, d) in [(25, 100), (25, 120), (50, 100), (75, 100), (100, 100), (137.5, 137.5), (200, 275)]:
    tol = 0.15
    near = clean & (np.abs(wid / w - 1) <= tol) & (np.abs(ln / d - 1) <= tol)
    print(w, d, 'cap', int(cap(np.array([w]), np.array([w * d]))[0]), 'n', near.sum(), 'p99.5/p99.9/max', [int(np.percentile(S[near], q, method='higher')) for q in (99.5, 99.9)], S[near].max(), ' b:', [int(np.percentile(S[near & (year > 0) & (year < 1960)], q, method='higher')) for q in (99, 99.9)])
# the share of sites exceeding when caps scaled
for sc in (0.5, 0.75, 1.0):
    print('scale', sc, 'exceed a %.2f%% b %.2f%%' % (100 * np.mean(S[clean] > np.floor(H[clean] * sc)), 100 * np.mean(S[clean & (year > 0) & (year < 1960)] > np.floor(H[clean & (year > 0) & (year < 1960)] * sc))))
