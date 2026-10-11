import type { RequestHandler } from './$types';
import { dataKey } from '$lib/server/data/key';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  geojson: 'application/geo+json',
  pmtiles: 'application/vnd.pmtiles',
  pbf: 'application/octet-stream',
  bin: 'application/octet-stream'
};
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'Content-Range, Content-Length, ETag, Accept-Ranges'
};

function text(status: number, body: string, cache: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': cache, ...CORS }
  });
}

function objectHeaders(obj: R2Object, path: string): Headers {
  const h = new Headers(CORS);
  obj.writeHttpMetadata(h);
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  h.set(
    'content-type',
    CONTENT_TYPES[ext] ?? obj.httpMetadata?.contentType ?? 'application/octet-stream'
  );
  h.set('etag', obj.httpEtag);
  h.set('accept-ranges', 'bytes');
  h.set('last-modified', obj.uploaded.toUTCString());
  h.set('cache-control', IMMUTABLE);
  h.set('x-content-type-options', 'nosniff');
  return h;
}

/** Inclusive byte span R2 actually returned, clipped to the object. Null if empty. */
function span(
  r: { offset?: number; length?: number; suffix?: number },
  size: number
): { start: number; end: number } | null {
  let start: number, end: number;
  // workerd reports suffix requests as {offset, length}; the `suffix` key may be present but
  // undefined, so test its type rather than `in` (see e2e/data-route.spec.ts).
  if (typeof r.suffix === 'number') {
    start = Math.max(0, size - r.suffix);
    end = size - 1;
  } else {
    start = r.offset ?? 0;
    end = r.length === undefined ? size - 1 : Math.min(size, start + r.length) - 1;
  }
  return end >= start ? { start, end } : null;
}

const SINGLE_RANGE_RE = /^bytes=(\d*)-(\d*)$/;

/** Parse a single `bytes=` range; null when the header is not a valid single range. */
function parseSingleRange(h: string | null): { first: string; last: string } | null {
  const m = h ? SINGLE_RANGE_RE.exec(h.trim()) : null;
  return m && (m[1] || m[2]) ? { first: m[1], last: m[2] } : null;
}

/** RFC 9110 unsatisfiable: start at/after the end, or a zero-length suffix. */
function isUnsatisfiable(range: { first: string; last: string }, size: number): boolean {
  return range.first === '' ? Number(range.last) === 0 : Number(range.first) >= size;
}

function unsatisfiable(size: number): Response {
  return new Response(null, {
    status: 416,
    headers: { 'content-range': `bytes */${size}`, 'cache-control': 'no-store', ...CORS }
  });
}

export const GET: RequestHandler = async ({ params, request, platform }) => {
  const key = dataKey(params.version, params.path);
  if (!key) return text(404, 'Not found', 'no-store');
  const bucket = platform?.env?.BUCKET;
  if (!bucket) return text(503, 'Data storage unavailable', 'no-store');

  // Invalid or multi-range Range headers are ignored (RFC 9110 permits): serve 200 full.
  const range = parseSingleRange(request.headers.get('range'));
  const rangeHeaders = new Headers(request.headers);
  if (!range) rangeHeaders.delete('range');
  // Only ETag preconditions: R2 would otherwise also evaluate If-Modified-Since etc. from Headers.
  const onlyIf = new Headers();
  for (const name of ['if-match', 'if-none-match']) {
    const v = request.headers.get(name);
    if (v !== null) onlyIf.set(name, v);
  }

  let obj: R2Object | R2ObjectBody | null;
  try {
    obj = await bucket.get(key, { range: rangeHeaders, onlyIf });
  } catch (err) {
    if (!range) throw err;
    const meta = await bucket.head(key);
    if (!meta) return text(404, 'Not found', 'public, max-age=60');
    if (!isUnsatisfiable(range, meta.size)) throw err;
    return unsatisfiable(meta.size);
  }
  if (!obj) return text(404, 'Not found', 'public, max-age=60');

  const headers = objectHeaders(obj, params.path);
  if (!('body' in obj)) {
    return new Response(null, {
      status: request.headers.has('if-none-match') ? 304 : 412,
      headers
    });
  }
  // Local workerd R2 does not throw for a start past the end; it returns the whole object with
  // range {offset: 0, length: size}. Decide satisfiability from the header and the size instead
  // of trusting what R2 reports (see e2e/data-route.spec.ts).
  if (range && isUnsatisfiable(range, obj.size)) {
    return unsatisfiable(obj.size);
  }
  if (range && obj.range) {
    const s = span(obj.range, obj.size);
    if (!s) return unsatisfiable(obj.size);
    headers.set('content-range', `bytes ${s.start}-${s.end}/${obj.size}`);
    headers.set('content-length', String(s.end - s.start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
};

export const HEAD: RequestHandler = async ({ params, platform }) => {
  const key = dataKey(params.version, params.path);
  if (!key) return text(404, 'Not found', 'no-store');
  const bucket = platform?.env?.BUCKET;
  if (!bucket) return text(503, 'Data storage unavailable', 'no-store');
  const obj = await bucket.head(key);
  if (!obj) return text(404, 'Not found', 'public, max-age=60');
  const headers = objectHeaders(obj, params.path);
  headers.set('content-length', String(obj.size));
  return new Response(null, { status: 200, headers });
};

export const OPTIONS: RequestHandler = async () =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, OPTIONS',
      'access-control-allow-headers': 'Range, If-None-Match, If-Match',
      'access-control-max-age': '86400'
    }
  });
