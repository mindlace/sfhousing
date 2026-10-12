import { expect, it } from 'vitest';
import { RoofWorkerClient } from './roof-worker-client';
import { roofFixture } from './test-utils/roof-fixtures';
class FakeWorker extends EventTarget {
  messages: unknown[] = [];
  postMessage(message: unknown) {
    this.messages.push(message);
  }
  terminate() {}
}
it('rejects all pending jobs after worker failure and refuses late results', async () => {
  const worker = new FakeWorker();
  const client = new RoofWorkerClient(() => worker as unknown as Worker);
  const first = client.load(roofFixture().ref, 'fixture-0', new AbortController().signal);
  const second = client.load(roofFixture('b').ref, 'fixture-0', new AbortController().signal);
  const rejected = Promise.all([
    expect(first).rejects.toThrow('worker'),
    expect(second).rejects.toThrow('worker')
  ]);
  worker.dispatchEvent(new Event('error'));
  await rejected;
  client.destroy();
  await expect(
    client.load(roofFixture().ref, 'fixture-0', new AbortController().signal)
  ).rejects.toThrow();
});
it('cancels only its request and rejects on destroy', async () => {
  const worker = new FakeWorker();
  const client = new RoofWorkerClient(() => worker as unknown as Worker);
  const abort = new AbortController();
  const load = client.load(roofFixture().ref, 'fixture-0', abort.signal);
  const rejected = expect(load).rejects.toMatchObject({ name: 'AbortError' });
  abort.abort();
  worker.dispatchEvent(
    new MessageEvent('message', { data: { type: 'failed', requestId: 1, message: 'cancelled' } })
  );
  await rejected;
  expect(worker.messages.at(-1)).toEqual({ type: 'cancel', requestId: 1 });
  const pending = client.load(roofFixture().ref, 'fixture-0', new AbortController().signal);
  const destroyed = expect(pending).rejects.toThrow();
  client.destroy();
  await destroyed;
});
it('discards a transferred result queued before a cancellation was processed', async () => {
  const worker = new FakeWorker();
  const client = new RoofWorkerClient(() => worker as unknown as Worker);
  const abort = new AbortController();
  const pending = client.load(roofFixture().ref, 'fixture-0', abort.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  abort.abort();
  worker.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'loaded', requestId: 1, chunk: roofFixture().chunk }
    })
  );
  await rejected;
  expect(worker.messages.at(-1)).toEqual({ type: 'cancel', requestId: 1 });
  client.destroy();
});
