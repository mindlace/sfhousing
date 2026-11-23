import { describe, expect, it } from 'vitest';
import { AUTH_COPY } from '$lib/account/copy';
import { refuseForeignOrigin, refuseUnlessSameOriginJson } from './same-origin-json';

function check(headers: Record<string, string>) {
  return refuseUnlessSameOriginJson({
    request: new Request('http://localhost/x', { method: 'POST', headers }),
    url: new URL('http://localhost/x')
  });
}

describe('refuseUnlessSameOriginJson', () => {
  it('allows application/json with no Origin', () => {
    expect(check({ 'content-type': 'application/json' })).toBeNull();
  });

  it('allows application/json with a charset and the same Origin', () => {
    expect(
      check({ 'content-type': 'Application/JSON; charset=utf-8', origin: 'http://localhost' })
    ).toBeNull();
  });

  it('answers 415 with no content type', async () => {
    const res = check({})!;
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: AUTH_COPY.jsonRequired });
  });

  it('answers 415 for a form content type', () => {
    expect(check({ 'content-type': 'text/plain' })!.status).toBe(415);
  });

  it('answers 403 for a foreign Origin', async () => {
    const res = check({ 'content-type': 'application/json', origin: 'https://evil.example' })!;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: AUTH_COPY.crossOrigin });
  });

  it('answers 403 for the string Origin "null" (an opaque origin)', () => {
    expect(check({ 'content-type': 'application/json', origin: 'null' })!.status).toBe(403);
  });

  it('allows an upper-case JSON content type from the same Origin', () => {
    expect(check({ 'content-type': 'APPLICATION/JSON', origin: 'http://localhost' })).toBeNull();
  });

  it('answers 403 for an empty Origin', () => {
    expect(check({ 'content-type': 'application/json', origin: '' })!.status).toBe(403);
  });
});

describe('refuseForeignOrigin', () => {
  const ev = (origin: string | null) => ({
    request: new Request('http://localhost/x', origin === null ? {} : { headers: { origin } }),
    url: new URL('http://localhost/x')
  });
  it('refuses another origin with 403 and passes this one or none', () => {
    expect(refuseForeignOrigin(ev('https://evil.example'))?.status).toBe(403);
    expect(refuseForeignOrigin(ev('http://localhost'))).toBeNull();
    expect(refuseForeignOrigin(ev(null))).toBeNull();
  });
  it('refuses an empty Origin, as before', () => {
    expect(refuseForeignOrigin(ev(''))?.status).toBe(403);
  });
});
