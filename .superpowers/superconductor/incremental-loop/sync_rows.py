"""Compare (or with --write, replace) each spec's copies of the design's interface rows.

Usage: sync_rows.py [--write] <design.html> <spec.html> [<spec.html> ...]

A copy is a `sec-if-<row>` section, the `sec-global-constraints` section, or a line of the
`tbl-interfaces` table. Copies are compared with leading whitespace ignored outside `pre`.
"""
import re
import sys

SECTION = re.compile(r'<section id="(sec-if-[a-z0-9]+|sec-global-constraints)">')
ROW = re.compile(r'<tr><th scope="row">([A-Z][0-9]+)</th>.*</tr>')


def blocks(text):
    """Map section id -> (start, end) offsets of the whole section element."""
    out = {}
    for m in SECTION.finditer(text):
        depth = 0
        for t in re.finditer(r'<section\b|</section>', text[m.start():]):
            depth += 1 if t.group() != '</section>' else -1
            if depth == 0:
                out[m.group(1)] = (m.start(), m.start() + t.end())
                break
    return out


def norm(block):
    """The block with leading whitespace dropped on lines outside pre."""
    lines = []
    in_pre = False
    for line in block.split('\n'):
        lines.append(line if in_pre else line.strip())
        if '<pre' in line:
            in_pre = True
        if '</pre>' in line:
            in_pre = False
    return '\n'.join(lines)


def table_rows(text):
    """Map row id -> the row's line, inside tbl-interfaces only."""
    start = text.find('id="tbl-interfaces"')
    if start < 0:
        return {}
    end = text.find('</table>', start)
    return {m.group(1): m.group(0) for m in ROW.finditer(text[start:end])}


def main():
    args = sys.argv[1:]
    write = '--write' in args
    args = [a for a in args if a != '--write']
    design = open(args[0], encoding='utf-8').read()
    d_blocks = {k: design[a:b] for k, (a, b) in blocks(design).items()}
    d_rows = table_rows(design)
    for path in args[1:]:
        text = open(path, encoding='utf-8').read()
        name = path.rsplit('/', 1)[-1].replace('2026-11-24-', '').replace('-design.html', '')
        differs = []
        unknown = []
        for key, (a, b) in sorted(blocks(text).items(), key=lambda kv: -kv[1][0]):
            if key not in d_blocks:
                unknown.append(key)
            elif norm(text[a:b]) != norm(d_blocks[key]):
                differs.append(key)
                if write:
                    text = text[:a] + d_blocks[key] + text[b:]
        for rid, line in table_rows(text).items():
            if rid not in d_rows:
                unknown.append('row ' + rid)
            elif line != d_rows[rid]:
                differs.append('row ' + rid)
                if write:
                    text = text.replace(line, d_rows[rid])
        have = sorted(k for k in blocks(text) if k.startswith('sec-if-'))
        rows = sorted(table_rows(text))
        if write and differs:
            open(path, 'w', encoding='utf-8').write(text)
        print(f'{name}: sections {len(have)}, table rows {len(rows)}, '
              f'differs {sorted(differs)}, unknown {unknown}, '
              f'constraints {"yes" if "sec-global-constraints" in blocks(text) else "MISSING"}')
        sec_ids = sorted(k.replace('sec-if-', '').upper() for k in have)
        if sec_ids != rows:
            print(f'  table/sections mismatch: sections {sec_ids} rows {rows}')


main()
