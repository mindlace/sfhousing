import { describe, expect, it } from 'vitest';
import { readCapped } from './read-body';

const URL_ = 'http://localhost/api/plans';

function streamRequest(body: ReadableStream<Uint8Array>): Request {
  return new Request(URL_, { method: 'POST', body, duplex: 'half' } as RequestInit);
}

describe('readCapped', () => {
  it('accepts a body of exactly max bytes', async () => {
    const req = new Request(URL_, { method: 'POST', body: '0123456789' });
    expect(await readCapped(req, 10)).toEqual({ ok: true, text: '0123456789' });
  });

  it('rejects a body of max + 1 bytes', async () => {
    const req = new Request(URL_, { method: 'POST', body: '0123456789A' });
    expect(await readCapped(req, 10)).toEqual({ ok: false, reason: 'too_large' });
  });

  it('stops pulling once the cap is exceeded', async () => {
    const CHUNK = 1024;
    const TOTAL_CHUNKS = 300;
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (pulled >= TOTAL_CHUNKS) {
            controller.close();
            return;
          }
          pulled++;
          controller.enqueue(new Uint8Array(CHUNK).fill(0x61));
        },
        cancel() {
          cancelled = true;
        }
      },
      { highWaterMark: 0 }
    );
    const result = await readCapped(streamRequest(stream), 262_144);
    expect(result).toEqual({ ok: false, reason: 'too_large' });
    expect(pulled).toBeLessThanOrEqual(258);
    expect(cancelled).toBe(true);
  });

  it('decodes multibyte UTF-8 split across chunks', async () => {
    const text = 'é'.repeat(1000);
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + 3));
        offset += 3;
      }
    });
    expect(await readCapped(streamRequest(stream), 262_144)).toEqual({ ok: true, text });
  });

  it('returns empty text for a request with no body', async () => {
    const req = new Request(URL_, { method: 'POST' });
    expect(await readCapped(req, 10)).toEqual({ ok: true, text: '' });
  });

  it('ignores a lying Content-Length header', async () => {
    const req = new Request(URL_, {
      method: 'POST',
      body: '0123456789A',
      headers: { 'content-length': '1' }
    });
    expect(await readCapped(req, 10)).toEqual({ ok: false, reason: 'too_large' });
  });
});
