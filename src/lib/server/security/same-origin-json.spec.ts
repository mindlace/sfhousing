import { describe, expect, it } from 'vitest';
import { SIMS_COPY } from '$lib/members/copy';
import { refuseUnlessSameOriginJson } from './same-origin-json';

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
    expect(await res.json()).toEqual({ error: SIMS_COPY.jsonRequired });
  });

  it('answers 415 for a form content type', () => {
    expect(check({ 'content-type': 'text/plain' })!.status).toBe(415);
  });

  it('answers 403 for a foreign Origin', async () => {
    const res = check({ 'content-type': 'application/json', origin: 'https://evil.example' })!;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: SIMS_COPY.crossOrigin });
  });
});
