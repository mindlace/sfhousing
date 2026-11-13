"""Fill {{ROW Sx}} and {{CONSTRAINTS}} in the spec sources from the design doc, so every spec
carries its interface rows and the global constraints word for word.
usage: build.py <design.md> <src dir> <out dir>"""
import os
import re
import sys

design, src, out = sys.argv[1:4]
d = open(design).read()

rows = {}
for line in d.splitlines():
    m = re.match(r'^\| (S\d+) \| ([MD]) \| (.*) \| (`[a-z-]+`) \|$', line)
    if m:
        rows[m.group(1)] = (m.group(2), m.group(3), m.group(4))

i = d.index('## 9. Global constraints')
j = d.index('## 10. The spike')
constraints = d[i:j].split('\n', 1)[1].strip()


def row(m):
    k = m.group(1)
    mark, text, owner = rows[k]
    kind = 'model commitment' if mark == 'M' else 'decomposition choice'
    return f'**{k}** ({kind}; owner {owner}). ' + text.replace('\\|', '|')


for name in sorted(os.listdir(src)):
    if not name.endswith('.md'):
        continue
    t = open(os.path.join(src, name)).read()
    t = re.sub(r'\{\{ROW (S\d+)\}\}', row, t)
    t = t.replace('{{CONSTRAINTS}}', constraints)
    assert '{{' not in t, (name, t[t.index('{{'):][:40])
    open(os.path.join(out, name), 'w').write(t)
    print('wrote', name, len(t.splitlines()), 'lines')
