// In-memory R2Bucket subset: get (range/onlyIf as Headers), head, put. Mirrors the
// workers R2 API shape the /data route depends on; not a general R2 emulator.
type Stored = { bytes: Uint8Array; etag: string; uploaded: Date; contentType?: string };

export type FakeRange = { offset: number; length?: number } | { suffix: number };

export class FakeR2Bucket {
  calls: { method: 'get' | 'head'; key: string }[] = [];
  lastGetOptions: { range?: Headers; onlyIf?: Headers } | undefined;
  private objects = new Map<string, Stored>();
  private n = 0;

  put(key: string, body: Uint8Array | string, opts: { contentType?: string } = {}): void {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    this.objects.set(key, {
      bytes,
      etag: `etag${++this.n}`,
      uploaded: new Date('2026-10-10T00:00:00Z'),
      contentType: opts.contentType
    });
  }

  private meta(key: string, s: Stored, range?: FakeRange) {
    return {
      key,
      size: s.bytes.length,
      etag: s.etag,
      httpEtag: `"${s.etag}"`,
      uploaded: s.uploaded,
      httpMetadata: { contentType: s.contentType },
      range,
      writeHttpMetadata(h: Headers) {
        if (s.contentType) h.set('content-type', s.contentType);
      }
    };
  }

  async head(key: string) {
    this.calls.push({ method: 'head', key });
    const s = this.objects.get(key);
    return s ? this.meta(key, s) : null;
  }

  async get(key: string, opts: { range?: Headers; onlyIf?: Headers } = {}) {
    this.calls.push({ method: 'get', key });
    this.lastGetOptions = opts;
    const s = this.objects.get(key);
    if (!s) return null;
    const inm = opts.onlyIf?.get('if-none-match');
    const im = opts.onlyIf?.get('if-match');
    const etagMatches = (v: string) =>
      v.trim() === '*' || v.split(',').some((t) => t.trim().replace(/^W\//, '') === `"${s.etag}"`);
    if ((inm && etagMatches(inm)) || (im && !etagMatches(im))) return this.meta(key, s); // no body
    const range = parseRange(opts.range?.get('range') ?? null, s.bytes.length);
    let slice = s.bytes;
    if (range) {
      const { start, end } = resolve(range, s.bytes.length);
      slice = s.bytes.slice(start, end + 1);
    }
    return {
      ...this.meta(key, s, range ?? undefined),
      body: new Blob([slice as BlobPart]).stream(),
      arrayBuffer: async () => slice.slice().buffer,
      text: async () => new TextDecoder().decode(slice)
    };
  }
}

function parseRange(h: string | null, size: number): FakeRange | null {
  if (!h) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(h.trim());
  if (!m || (m[1] === '' && m[2] === '')) throw new Error('invalid range');
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) throw new Error('unsatisfiable range');
    // Real workerd (local R2) reports a suffix request as a resolved {offset, length}, with
    // `suffix` present-but-undefined (observed by e2e/data-route.spec.ts).
    return { offset: Math.max(0, size - suffix), length: Math.min(suffix, size) };
  }
  const offset = Number(m[1]);
  // The fake throws here (spec §4.4.6, I) to exercise the route's catch path. Local workerd R2
  // does NOT throw: it returns the whole object (range {offset: 0, length: size}); the route
  // therefore also checks satisfiability itself (e2e/data-route.spec.ts 416 case).
  if (offset >= size) throw new Error('unsatisfiable range');
  // `length` is deliberately not clipped: R2 may return fewer bytes than requested.
  return m[2] === '' ? { offset } : { offset, length: Number(m[2]) - offset + 1 };
}

function resolve(r: FakeRange, size: number) {
  if ('suffix' in r) return { start: Math.max(0, size - r.suffix), end: size - 1 };
  const end = r.length === undefined ? size - 1 : Math.min(size, r.offset + r.length) - 1;
  return { start: r.offset, end };
}
