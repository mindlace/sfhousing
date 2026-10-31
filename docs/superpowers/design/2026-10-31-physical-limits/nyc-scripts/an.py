import sys
import numpy as np
import pandas as pd
A = np.logical_and
d = pd.read_csv(sys.argv[1])
d['irr'] = d.irrlotcode.astype(str).str.lower().isin(['true', 'y', '1'])
d = d[A(A(d.numfloors.ge(1), d.lotfront.gt(0)), d.lotarea.gt(0))]
print(len(d), 'irr share', d.irr.mean())
reg = d[d.irr.eq(False)]
wb = [0, 20, 30, 40, 60, 80, 120, 200, 1e9]
wl = ['lt20', '20-30', '30-40', '40-60', '60-80', '80-120', '120-200', '200plus']
ab = [0, 2000, 3000, 5000, 10000, 20000, 40000, 1e12]
al = ['lt2k', '2-3k', '3-5k', '5-10k', '10-20k', '20-40k', '40kplus']
mn = reg.borough.eq('MN')
cuts = [
  ('a all regular', reg),
  ('b Manhattan', reg[mn]),
  ('c pre-1961', reg[A(reg.yearbuilt.gt(1800), reg.yearbuilt.lt(1961))]),
  ('d post-2000', reg[reg.yearbuilt.ge(2000)]),
  ('e Manhattan post-2000', reg[A(mn, reg.yearbuilt.ge(2000))]),
  ('f irregular all', d[d.irr]),
]
C = dict(cuts)
def tab(df, col, b, l):
    g = df.groupby(pd.cut(df[col], b, labels=l, right=False), observed=False).numfloors
    t = g.agg(n='size', p50=lambda x: x.quantile(.5), p90=lambda x: x.quantile(.9),
              p95=lambda x: x.quantile(.95), p99=lambda x: x.quantile(.99), max='max')
    return t.round(1).fillna('')
out = []
for k, df in cuts:
    out.append('\n### ' + k + ' n=' + str(len(df)) + '\n\nBy frontage (ft)\n\n' + tab(df, 'lotfront', wb, wl).to_markdown() + '\n\nBy lot area (ft2)\n\n' + tab(df, 'lotarea', ab, al).to_markdown())
refs = [(25, 100), (25, 120), (50, 100), (75, 100), (100, 100), (137.5, 137.5), (200, 275)]
rows = []
for k in ['a all regular', 'b Manhattan', 'c pre-1961', 'd post-2000', 'e Manhattan post-2000']:
    df = C[k]
    for w, dp in refs:
        m = df[A(df.lotfront.between(w * .9, w * 1.1), df.lotarea.between(w * dp * .85, w * dp * 1.15))]
        name = str(w) + 'x' + str(dp)
        if len(m) == 0:
            rows.append((k, name, 0, '', '', '', ''))
            continue
        q = m.numfloors.quantile
        rows.append((k, name, len(m), q(.5), q(.95), q(.99), m.numfloors.max()))
out.append('\n### Reference lots (frontage +-10pct, area +-15pct)\n\n' + pd.DataFrame(rows, columns=['cut', 'lot', 'n', 'p50', 'p95', 'p99', 'max']).to_markdown(index=False))
t = C['d post-2000'].sort_values('numfloors', ascending=False)
cols = ['borough', 'bldgclass', 'lotfront', 'lotdepth', 'lotarea', 'numfloors', 'yearbuilt']
out.append('\n### Tallest post-2000 regular lots (frontage le 60)\n\n' + t[t.lotfront.le(60)].head(12)[cols].to_markdown(index=False))
out.append('\n### Tallest post-2000 regular lots, all\n\n' + t.head(8)[cols].to_markdown(index=False))
df = C['d post-2000'].copy()
df['md'] = df[['lotfront', 'lotdepth']].min(axis=1)
df = df[df.md.gt(0)]
df['sl'] = df.numfloors * 10 / df.md
out.append('\n### Slenderness (stories*10ft / min(front,depth)) post-2000, stories ge 30\n\n' + df[df.numfloors.ge(30)].sort_values('sl', ascending=False).head(10)[['borough', 'lotfront', 'lotdepth', 'numfloors', 'yearbuilt', 'sl']].round(1).to_markdown(index=False))
for k in ['c pre-1961', 'd post-2000']:
    x = C[k].copy()
    x['md'] = x[['lotfront', 'lotdepth']].min(axis=1)
    out.append('\n### ' + k + ' by min(front,depth)\n\n' + tab(x, 'md', wb, wl).to_markdown())
print('\n'.join(out))
