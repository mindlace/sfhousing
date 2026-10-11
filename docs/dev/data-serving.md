# Data serving

Static, versioned geographic data is served from R2 by `src/routes/data/[version]/[...path]/+server.ts` (exports `GET`, `HEAD`, `OPTIONS`). The worker never parses object bodies.

## Key layout

URL `/data/<datasetVersion>/<path>` maps to R2 key `data/<datasetVersion>/<path>`. Uploaders must use exactly these keys. `datasetVersion` matches `^(\d{4}-\d{2}-\d{2}-[0-9a-f]{8}|fixture-\d+)$` (`DATASET_VERSION_RE`). The pipeline uploads `manifest.json` last so a version is never visible half-uploaded.

## Path validation

Done before any R2 call (`src/lib/server/data/key.ts`): `version` must match the pattern above; `path` is 1 to 256 characters and every `/`-separated segment must match `^[A-Za-z0-9._-]+$` and not be `.` or `..`. Failure gives 404 `Not found` with `Cache-Control: no-store`.

Because of this, **no segment may contain spaces or commas**. MapLibre glyph URLs built from a fontstack such as "Noto Sans Regular" or a comma-joined stack would 404; name fontstack directories with only `A-Za-z0-9._-` (for example `NotoSans-Regular`).

## GET

| Condition                                              | Status | Notes                                                         |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------- |
| invalid path/version                                   | 404    | `no-store`                                                    |
| `BUCKET` missing                                       | 503    | `Data storage unavailable`, `no-store`                        |
| object absent                                          | 404    | `public, max-age=60` so a late upload appears within a minute |
| `If-None-Match` matches                                | 304    | headers set, no body                                          |
| `If-Match` fails                                       | 412    | headers set, no body                                          |
| valid single `Range`, satisfiable                      | 206    | `Content-Range: bytes a-b/size`, `Content-Length`             |
| valid single `Range`, start at/after end or `bytes=-0` | 416    | `Content-Range: bytes */size`, `no-store`                     |
| otherwise                                              | 200    | `Content-Length: size`                                        |

Details that come from how R2 behaves:

- Only `If-Match` and `If-None-Match` are forwarded to R2 `onlyIf`. `If-Modified-Since` is not forwarded, so an IMS-only request gets 200.
- Invalid or multi-range `Range` headers are ignored (RFC 9110 permits) and the full object is returned with 200.
- 416 is decided by the route from the header and the object size. Local workerd R2 returns the whole object for a past-the-end range instead of throwing, and reports suffix ranges as resolved `{offset, length}`, so the route does not trust R2 for this.

## Headers

On every 200/206/304/412: `ETag` (R2 `httpEtag`), `Accept-Ranges: bytes`, `Last-Modified`, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`, and CORS (`Access-Control-Allow-Origin: *`, `Access-Control-Expose-Headers: Content-Range, Content-Length, ETag, Accept-Ranges`). The data is open; third parties may range-read it.

`Content-Type` is chosen by extension, overriding stored metadata: `.json` application/json, `.geojson` application/geo+json, `.pmtiles` application/vnd.pmtiles, `.pbf` and `.bin` application/octet-stream. Unknown extensions use the stored `httpMetadata.contentType`, else application/octet-stream. If the pipeline stores a pre-compressed object it sets `contentEncoding` and it passes through.

## HEAD and OPTIONS

`HEAD` uses `BUCKET.head`, same status and headers as a 200 GET with no body. `OPTIONS` returns 204 with `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`, `Access-Control-Allow-Headers: Range, If-None-Match, If-Match`, `Access-Control-Max-Age: 86400`. Other methods get 405.

## Caching

Browsers cache via `immutable`; the Worker Cache API is not used (it does not store 206s). Published versions are never modified, so a changed dataset means a new version path.
