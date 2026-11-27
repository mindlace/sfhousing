"""Summarize <WORK>/<set>/compare.json into one table (markdown) and results.json."""

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SPIKE, WORK  # noqa: E402

SETS = ['salesforce', 'salesforce_top', 'sutro', 'downtown', 'downtown_top', 'rowhouse', 'rowhouse_top', 'detached', 'detached_top']
out = {}
print('| set | bldgs | roofer modes | roofer t_run ms p50/max | DSM RMSE m roofer/ours (median over bldgs) | '
      'DSM within 1 m roofer/ours | tris/bldg roofer LoD2.2 (LoD1.3)/ours | glb bytes/bldg roofer/ours (gzip) |')
print('|---|---|---|---|---|---|---|---|')
for s in SETS:
  d = json.load(open(os.path.join(WORK, s, 'compare.json')))
  b = d['buildings']
  n = len(b)
  modes = {}
  for r in b:
    k = r['extrusion_mode'] if r['roofer_present'] else 'absent'
    modes[k] = modes.get(k, 0) + 1
  t = [r['t_run_ms'] for r in b if r['t_run_ms'] is not None]

  def med(key, side):
    v = [r[side][key] for r in b if r[side] and r[side][key] is not None]
    return float(np.median(v)) if v else float('nan')

  def tot(key):
    return sum(r[key] or 0 for r in b)

  row = dict(
    n=n,
    modes=modes,
    t_run_p50=float(np.median(t)) if t else None,
    t_run_max=max(t) if t else None,
    t_run_sum=sum(t),
    rmse_roofer=med('rmse', 'fit_roofer'),
    rmse_ours=med('rmse', 'fit_ours'),
    w1_roofer=med('within_1m', 'fit_roofer'),
    w1_ours=med('within_1m', 'fit_ours'),
    miss_roofer=med('miss', 'fit_roofer'),
    miss_ours=med('miss', 'fit_ours'),
    tri22=tot('tri_lod22') / n,
    tri13=tot('tri_lod13') / n,
    tri_ours=tot('tri_ours') / n,
    glb_roofer=d['glb_roofer'],
    glb_ours=d['glb_ours'],
  )
  out[s] = row
  print(
    f"| {s} | {n} | {', '.join(f'{k} {v}' for k, v in modes.items())} | "
    f"{row['t_run_p50']:.0f} / {row['t_run_max']} | {row['rmse_roofer']:.2f} / {row['rmse_ours']:.2f} | "
    f"{row['w1_roofer']:.0%} / {row['w1_ours']:.0%} | {row['tri22']:.0f} ({row['tri13']:.0f}) / "
    f"{row['tri_ours']:.0f} | {d['glb_roofer'][0] / n:,.0f} ({d['glb_roofer'][1] / n:,.0f}) / "
    f"{d['glb_ours'][0] / n:,.0f} ({d['glb_ours'][1] / n:,.0f}) |"
  )
  if s in ('detached', 'rowhouse', 'downtown'):
    for r in b:
      fr, fo = r['fit_roofer'], r['fit_ours']
      print(
        f"    {r['bid'][:8]} {r['area_m2']:>8} {r['extrusion_mode']} {r['roof_type']} "
        f"t={r['t_run_ms']} rf={fr and round(fr['rmse'] or -1, 2)} ours={fo and round(fo['rmse'] or -1, 2)} "
        f"miss_rf={fr and round(fr['miss'], 2)} tri={r['tri_lod22']}/{r['tri_ours']} fb={r['ours_fallback']}"
      )
with open(os.path.join(SPIKE, 'results.json'), 'w') as f:
  json.dump(out, f, indent=1)
