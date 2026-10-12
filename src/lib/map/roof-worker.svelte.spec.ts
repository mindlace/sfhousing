import { expect, it } from 'vitest';
import { loadRoofChunk } from './roof-worker';
import { roofFixture } from './test-utils/roof-fixtures';
import { jsonBytes } from '$lib/data/building-roofs';
async function hashedFixture() {
  const f = roofFixture();
  const hash = async (b: ArrayBuffer) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (n) =>
      n.toString(16).padStart(2, '0')
    ).join('');
  f.ref.headerSha256 = await hash(f.headerBytes.buffer);
  f.ref.meshSha256 = await hash(f.buffer);
  return f;
}
it('rejects oversized and truncated streamed bodies without trusting Content-Length', async () => {
  const f = await hashedFixture();
  for (const bytes of [
    new Uint8Array(f.buffer).slice(1),
    new Uint8Array(f.buffer.byteLength + 1)
  ]) {
    const fetcher = async (input: RequestInfo | URL) =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(String(input).endsWith('.json') ? f.headerBytes : bytes);
            c.close();
          }
        })
      );
    await expect(
      loadRoofChunk(f.ref, 'fixture-0', jsonBytes(f.ref), new AbortController().signal, fetcher)
    ).rejects.toThrow();
  }
});
it('decodes valid hashes and rejects header identity and measured index overflow', async () => {
  const f = await hashedFixture();
  const fetcher = async (input: RequestInfo | URL) =>
    new Response(String(input).endsWith('.json') ? f.headerBytes : f.buffer);
  const result = await loadRoofChunk(
    f.ref,
    'fixture-0',
    jsonBytes(f.ref),
    new AbortController().signal,
    fetcher
  );
  expect([...result.indices]).toEqual([0, 1, 2]);
  await expect(
    loadRoofChunk(
      { ...f.ref, chunkId: 'other' },
      'fixture-0',
      jsonBytes(f.ref),
      new AbortController().signal,
      fetcher
    )
  ).rejects.toThrow();
  await expect(
    loadRoofChunk(f.ref, 'fixture-0', 4 * 1024 * 1024, new AbortController().signal, fetcher)
  ).rejects.toThrow();
});

import { RoofWorkerClient } from './roof-worker-client';
function eventOf(worker: Worker, type: string) {
  return new Promise<MessageEvent>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`missing worker event ${type}`)), 5000);
    const listener = (event: MessageEvent) => {
      if (event.data.type === type) {
        clearTimeout(timer);
        worker.removeEventListener('message', listener);
        resolve(event);
      }
    };
    worker.addEventListener('message', listener);
  });
}
async function realWorker(
  f: Awaited<ReturnType<typeof hashedFixture>>,
  mesh = new Uint8Array(f.buffer),
  holdHash = false
) {
  const worker = new Worker(new URL('./test-utils/roof-worker-harness.ts', import.meta.url), {
    type: 'module'
  });
  const ready = eventOf(worker, 'fixture-ready');
  worker.postMessage({ type: 'fixture', header: f.headerBytes, mesh, holdHash });
  await ready;
  return worker;
}
it('runs the production module handler off thread and detaches all four transferred mesh arrays', async () => {
  const f = await hashedFixture();
  const worker = await realWorker(f);
  const client = new RoofWorkerClient(() => worker);
  try {
    const proof = eventOf(worker, 'transfer-proof');
    const chunk = await client.load(
      f.ref,
      'fixture-0',
      new AbortController().signal,
      jsonBytes(f.ref)
    );
    expect([...chunk.positions]).toEqual([0, 0, 10, 1, 0, 10, 0, 1, 10]);
    expect([...chunk.indices]).toEqual([0, 1, 2]);
    expect((await proof).data.lengths).toEqual([0, 0, 0, 0]);
  } finally {
    client.destroy();
  }
});
it('real worker rejects hostile, truncated, oversized and corrupt bodies before readiness', async () => {
  const f = await hashedFixture();
  for (const [ref, bytes] of [
    [{ ...f.ref, chunkId: 'hostile' }, new Uint8Array(f.buffer)],
    [f.ref, new Uint8Array(f.buffer).slice(1)],
    [f.ref, new Uint8Array(f.buffer.byteLength + 1)],
    [{ ...f.ref, meshSha256: 'f'.repeat(64) }, new Uint8Array(f.buffer)]
  ] as const) {
    const worker = await realWorker(f, bytes);
    const client = new RoofWorkerClient(() => worker);
    try {
      await expect(
        client.load(ref, 'fixture-0', new AbortController().signal, jsonBytes(ref))
      ).rejects.toThrow();
    } finally {
      client.destroy();
    }
  }
});
it('holds cancellation ownership until an in-progress real worker hash acknowledges abort', async () => {
  const f = await hashedFixture();
  const worker = await realWorker(f, undefined, true);
  const client = new RoofWorkerClient(() => worker);
  const abort = new AbortController();
  try {
    const held = eventOf(worker, 'hash-held');
    let settled = false;
    const pending = client.load(f.ref, 'fixture-0', abort.signal).finally(() => {
      settled = true;
    });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await held;
    abort.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    worker.postMessage({ type: 'release-hash' });
    await rejected;
    expect(settled).toBe(true);
  } finally {
    client.destroy();
  }
});
