import collections
import sys
import xml.etree.ElementTree as ET

r = ET.parse(sys.argv[1]).getroot()
print('root', r.tag)
ids = [e.get('id') for e in r.iter() if e.get('id')]
print('dup ids', [k for k, v in collections.Counter(ids).items() if v > 1])
print('h1', len(list(r.iter('h1'))))
print(
    'missing id',
    [e.tag for e in r.iter() if e.tag in ('section', 'figure', 'table') and not e.get('id')],
)
nodes = {e.get('id') for e in r.iter('g') if 'node' in (e.get('class') or '')}
print(
    'bad edges',
    [
        (e.get('data-from'), e.get('data-to'))
        for e in r.iter('g')
        if e.get('class') == 'edge'
        and (e.get('data-from') not in nodes or e.get('data-to') not in nodes)
    ],
)
allowed = set(
    (
        'article header section h1 h2 h3 h4 hr p ul ol li dl dt dd blockquote details summary '
        'a em strong code kbd mark sub sup br input aside pre table caption thead tbody tfoot '
        'tr th td figure figcaption img video svg g rect circle ellipse line path polyline '
        'polygon text tspan title desc defs marker'
    ).split()
)
print('disallowed', {e.tag for e in r.iter()} - allowed)
print('tables without caption', [e.get('id') for e in r.iter('table') if e.find('caption') is None])
print('markers', len(list(r.iter('marker'))))
print('th without scope', len([e for e in r.iter('th') if not e.get('scope')]))
