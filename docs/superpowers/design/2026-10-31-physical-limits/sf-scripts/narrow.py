import sys, csv
import numpy as np
rows = list(csv.DictReader(open(sys.argv[1])))
def col(n, t=float):
    return np.array([t(r[n]) for r in rows])
M = 1 / 0.3048
wid = col('wid_m') * M; ln = col('len_m') * M; area = col('area_m2') * M * M
hm = col('h_med'); hp = col('h_peak'); year = col('year', int); multi = col('multipoly', int)
fpw = col('fp_wid_m') * M; fpl = col('fp_len_m') * M; fpa = col('fp_area') * M * M
S = np.where(hm > 4.5, np.floor((hm - 4.5) / 3.1 + 0.5) + 1, 1).astype(int)
clean = (multi == 0) & (fpw <= 1.15 * wid + 3) & (fpl <= 1.15 * ln + 3)
mm = np.where(clean & (S >= 7) & (wid < 38))[0]
print(len(mm), 'sites S>=7 and wid<38')
for i in mm:
    print(rows[i]['lot_id'], S[i], 'h %.0f peak %.0f' % (hm[i], hp[i]), 'wid %.0f len %.0f area %.0f fpa %.0f fp %.0fx%.0f yr %d nl %s %s' % (wid[i], ln[i], area[i], fpa[i], fpw[i], fpl[i], year[i], rows[i]['nlots'], rows[i]['district']))
