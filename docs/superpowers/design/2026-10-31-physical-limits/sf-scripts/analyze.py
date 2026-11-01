import sys, csv
import numpy as np
src = sys.argv[1]
rows = list(csv.DictReader(open(src)))
def col(n, t=float):
    return np.array([t(r[n]) for r in rows])
M2FT = 1 / 0.3048
wid = col('wid_m') * M2FT; ln = col('len_m') * M2FT; mrr = col('mrr_min_m') * M2FT
area = col('area_m2') * M2FT ** 2
hm = col('h_med'); hp = col('h_peak'); year = col('year', int)
nlots = col('nlots', int); multi = col('multipoly', int)
base = col('base_st', int); env = col('env_st', int)
fpw = col('fp_wid_m') * M2FT
def stories(h, fl):
    s = np.floor((h - 4.5) / fl + 0.5) + 1
    return np.where(h > 4.5, s, 1).astype(int)
S31 = stories(hm, 3.1); S30 = stories(hm, 3.0); S31p = stories(hp, 3.1)
fpl = col('fp_len_m') * M2FT
clean = (fpw <= 1.15 * wid + 3) & (fpl <= 1.15 * ln + 3)
ok = (multi == 0) & (clean if len(sys.argv) > 3 else True)
cuts = dict(a=ok, b=ok & (year > 0) & (year < 1960))
out = []
def P(s=''):
    out.append(s)
def pct(x, q):
    return int(np.percentile(x, q, method='higher'))
def table(title, edges, labels, v, S):
    P('### ' + title)
    P('')
    for c in 'ab':
        m = cuts[c]
        P('Cut (%s): %s, N=%d' % (c, 'all buildings' if c == 'a' else 'built before 1960 (roll year_property_built, 1 to 1959)', m.sum()))
        P('')
        P('| bin | n | p50 | p90 | p95 | p99 | max |')
        P('|---|---|---|---|---|---|---|')
        for i, lab in enumerate(labels):
            mm = m & (v >= edges[i]) & (v < edges[i + 1])
            if mm.sum() == 0:
                P('| %s | 0 | | | | | |' % lab); continue
            x = S[mm]
            P('| %s | %d | %d | %d | %d | %d | %d |' % (lab, mm.sum(), pct(x, 50), pct(x, 90), pct(x, 95), pct(x, 99), x.max()))
        P('')
W_E = [0, 20, 30, 40, 60, 80, 120, 200, 1e9]
W_L = ['<20', '20-30', '30-40', '40-60', '60-80', '80-120', '120-200', '200+']
A_E = [0, 2000, 3000, 5000, 10000, 20000, 40000, 1e12]
A_L = ['<2k', '2-3k', '3-5k', '5-10k', '10-20k', '20-40k', '40k+']
P('## Table 1: stories by min-width bin (ft), median roof height, 4.5 m ground + 3.1 m/floor')
P('')
table('width', W_E, W_L, wid, S31)
P('## Table 2: stories by lot-area bin (ft2)')
P('')
table('area', A_E, A_L, area, S31)
P('## Variant: 3.0 m/floor (width bins; cut a and cut b)')
P('')
P('| width bin | a: p50 | p99 | max | b: p50 | p99 | max |')
P('|---|---|---|---|---|---|---|')
for i, lab in enumerate(W_L):
    r = []
    for c in 'ab':
        mm = cuts[c] & (wid >= W_E[i]) & (wid < W_E[i + 1])
        x = S30[mm]
        r += [pct(x, 50), pct(x, 99), x.max()] if mm.sum() else ['', '', '']
    P('| %s | %s |' % (lab, ' | '.join(str(z) for z in r)))
P('')
P('## Variant: peak (max LiDAR) roof height instead of median, cut a')
P('')
P('| width bin | p50 | p99 | max |')
P('|---|---|---|---|')
for i, lab in enumerate(W_L):
    mm = cuts['a'] & (wid >= W_E[i]) & (wid < W_E[i + 1])
    x = S31p[mm]
    P('| %s | %d | %d | %d |' % (lab, pct(x, 50), pct(x, 99), x.max()))
P('')
P('## Cut (c) envelope grid: max stories (n, p99) by width bin x area bin, cut a')
P('')
P('| width by area | ' + ' | '.join(A_L) + ' |')
P('|---|' + '---|' * len(A_L))
for i, lab in enumerate(W_L):
    cells = []
    for j in range(len(A_L)):
        mm = cuts['a'] & (wid >= W_E[i]) & (wid < W_E[i + 1]) & (area >= A_E[j]) & (area < A_E[j + 1])
        cells.append('%d (n=%d, p99 %d)' % (S31[mm].max(), mm.sum(), pct(S31[mm], 99)) if mm.sum() else '-')
    P('| %s | %s |' % (lab, ' | '.join(cells)))
P('')
P('## Share of sites at/near zoned height (cut a), by width bin')
P('')
P('base = parcels.bin baseStories (current base zoning); env = FZP envelopeStories. at = built >= zoned; near = built >= zoned-1. Only sites whose lot id is in parcels.bin with base>0 (resp. env>0).')
P('')
P('| width bin | n with base | at base | near base | n with env | at env | near env | median built/base |')
P('|---|---|---|---|---|---|---|---|')
for i, lab in enumerate(W_L):
    mm = ok & (wid >= W_E[i]) & (wid < W_E[i + 1])
    mb = mm & (base > 0); me = mm & (env > 0)
    if mb.sum() == 0:
        P('| %s | 0 | | | 0 | | | |' % lab); continue
    ae = 100 * np.mean(S31[me] >= env[me]) if me.sum() else 0
    ne = 100 * np.mean(S31[me] >= env[me] - 1) if me.sum() else 0
    P('| %s | %d | %.0f%% | %.0f%% | %d | %.0f%% | %.0f%% | %.2f |' % (lab, mb.sum(), 100 * np.mean(S31[mb] >= base[mb]), 100 * np.mean(S31[mb] >= base[mb] - 1), me.sum(), ae, ne, np.median(S31[mb] / base[mb])))
P('')
P('## Share at/near base-zoned height (cut a), by area bin')
P('')
P('| area bin | n with base | at base | near base |')
P('|---|---|---|---|')
for i, lab in enumerate(A_L):
    mm = ok & (area >= A_E[i]) & (area < A_E[i + 1]) & (base > 0)
    if mm.sum():
        P('| %s | %d | %.0f%% | %.0f%% |' % (lab, mm.sum(), 100 * np.mean(S31[mm] >= base[mm]), 100 * np.mean(S31[mm] >= base[mm] - 1)))
P('')
ma = ok & (base > 0); mb2 = cuts['b'] & (base > 0)
P('Sites built >=2 stories above base zoning: cut a %.1f%%, cut b %.1f%%' % (100 * np.mean(S31[ma] >= base[ma] + 2), 100 * np.mean(S31[mb2] >= base[mb2] + 2)))
P('')
P('## Table 3: reference lots (neighbours within +-15% on both principal extents; widened to 30% then 50% if n<30)')
P('')
P('| lot (ft) | tol | n a | a p50 | a p90 | a p99 | a max | n b | b p50 | b p90 | b p99 | b max |')
P('|---|---|---|---|---|---|---|---|---|---|---|---|')
for (w, d) in [(25, 100), (25, 120), (50, 100), (75, 100), (100, 100), (137.5, 137.5), (200, 275)]:
    for tol in (0.15, 0.30, 0.5):
        near = ok & (np.abs(wid / w - 1) <= tol) & (np.abs(ln / d - 1) <= tol)
        if near.sum() >= 30 or tol == 0.5:
            break
    r = []
    for c in 'ab':
        mm = near & cuts[c]
        x = S31[mm]
        r += [mm.sum(), pct(x, 50), pct(x, 90), pct(x, 99), x.max()] if mm.sum() else [0, '', '', '', '']
    P('| %gx%g | %d%% | %s |' % (w, d, int(tol * 100), ' | '.join(str(z) for z in r)))
P('')
P('## Tall buildings: slenderness = roof height / footprint min width (tallest building per site)')
P('')
for lo in (15, 20, 30, 40):
    t2 = ok & (S31 >= lo) & (fpw > 0)
    s2 = hm[t2] / (fpw[t2] / M2FT)
    P('- >=%d stories: n=%d, H/w p50 %.1f p90 %.1f max %.1f' % (lo, t2.sum(), np.percentile(s2, 50), np.percentile(s2, 90), s2.max()))
P('')
idx = np.argsort(-S31 * ok)[:25]
P('Top 25 tallest sites (median height):')
P('')
P('| lot | stories | h_med m | h_peak m | site wid ft | site len ft | site area ft2 | footprint wid ft | nlots | year |')
P('|---|---|---|---|---|---|---|---|---|---|')
for i in idx:
    P('| %s | %d | %.0f | %.0f | %.0f | %.0f | %.0f | %.0f | %d | %d |' % (rows[i]['lot_id'], S31[i], hm[i], hp[i], wid[i], ln[i], area[i], fpw[i], nlots[i], year[i]))
P('')
P('## Data quality counts')
P('')
P('- sites with a building: %d; multi-polygon sites dropped: %d' % (len(rows), multi.sum()))
P('- sites merged from >1 lot: %d (%.1f%%)' % ((nlots > 1).sum(), 100 * np.mean(nlots > 1)))
P('- year_property_built missing/0: %d; ==1900: %d; <1960: %d; 1960+: %d' % ((year == 0).sum(), (year == 1900).sum(), ((year > 0) & (year < 1960)).sum(), (year >= 1960).sum()))
P('- in parcels.bin (base>=0): %d' % (base >= 0).sum())
P('- width p50 %.0f ft; median wid/mrr_min ratio %.2f' % (np.median(wid), np.median(wid / np.maximum(mrr, 0.1))))
open(sys.argv[2], 'w').write('\n'.join(out))
print('\n'.join(out))
