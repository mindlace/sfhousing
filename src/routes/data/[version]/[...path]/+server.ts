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

type R2Range = { offset?: number; length?: number } | { suffix: number };

function text(status: number, body: string, cache: string): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': cache, ...CORS }
  });
}

function resolveKey(params: { version: string; path: string }) {
  return dataKey(params.version, params.path);
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
function span(r: R2Range, size: number): { start: number; end: number } | null {
  let start: number, end: number;
  if ('suffix' in r) {
    start = Math.max(0, size - r.suffix);
    end = size - 1;
  } else {
    start = r.offset ?? 0;
    end = r.length === undefined ? size - 1 : Math.min(size, start + r.length) - 1;
  }
  return end >= start ? { start, end } : null;
}

function unsatisfiable(size: number): Response {
  return new Response(null, {
    status: 416,
    headers: { 'content-range': `bytes */${size}`, 'cache-control': 'no-store', ...CORS }
  });
}

export const GET: RequestHandler = async ({ params, request, platform }) => {
  const key = resolveKey(params);
  if (!key) return text(404, 'Not found', 'no-store');
  const bucket = platform?.env?.BUCKET;
  if (!bucket) return text(503, 'Data storage unavailable', 'no-store');

  const rangeHeader = request.headers.get('range');
  const rangeHeaders = new Headers(request.headers);
  if (rangeHeader?.includes(',')) rangeHeaders.delete('range'); // multi-range → full 200
  const singleRange = rangeHeaders.has('range');

  let obj: R2Object | R2ObjectBody | null;
  try {
    obj = await bucket.get(key, { range: rangeHeaders, onlyIf: request.headers });
  } catch (err) {
    if (!singleRange) throw err;
    const meta = await bucket.head(key);
    if (!meta) return text(404, 'Not found', 'public, max-age=60');
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
  if (singleRange && obj.range) {
    const s = span(obj.range as R2Range, obj.size);
    if (!s) return unsatisfiable(obj.size);
    headers.set('content-range', `bytes ${s.start}-${s.end}/${obj.size}`);
    headers.set('content-length', String(s.end - s.start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
};

export const HEAD: RequestHandler = async ({ params, platform }) => {
  const key = resolveKey(params);
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
