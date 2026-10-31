import sys, zlib, struct, json
import numpy as np
src, out = sys.argv[1], sys.argv[2]
b = zlib.decompress(open(src,'rb').read(), -15)
assert b[:4]==b'SFHS'
H = struct.unpack_from('<I', b, 8)[0]
h = json.loads(b[12:12+H])
n = h['count']
cols = dict((c['name'], c) for c in h['columns'])
T = dict(u8='u1', u16='<u2', i32='<i4', u32='<u4')
def rd(name):
    c = cols[name]
    dt = np.dtype(T[c['type']])
    return np.frombuffer(b, dtype=dt, count=c['byteLength']//dt.itemsize, offset=c['offset'])
pre = rd("idPrefix").astype(int); ln = rd("idSuffixLen").astype(int); suf = bytes(rd('idSuffix'))
ids = []; prev = ''; at = 0
for i in range(n):
    s = prev[:pre[i]] + suf[at:at+ln[i]].decode(); at += ln[i]; ids.append(s); prev = s
d = h['districts']; dist = rd('district')
np.savez(out, id=np.array(ids), env=rd('envelopeStories'), base=rd('baseStories'), flags=rd('flags'), imputed=rd('imputed'),
  lot=rd('lotAreaM2'), year=rd('yearBuilt'), ests=rd('existingStories'), district=np.array([d[i] for i in dist]), lng=rd('labelLng')/1e7, lat=rd('labelLat')/1e7)
print(n, ids[:3], h['rollYear'])
