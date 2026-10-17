import { describe, expect, it } from 'vitest';
import { scenarioTiny } from './fixtures/scenario-tiny';
import { ScenarioFormatError, encodeScenarioPayload, readScenarioParcels } from './scenario-codec';

const oneChunk = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    }
  });

// The DOM lib types the writable side as BufferSource; the encoder's Uint8Array is the same bytes.
const deflateRaw = (bytes: Uint8Array) =>
  oneChunk(bytes).pipeThrough(
    new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>
  );

describe('readScenarioParcels in the browser', () => {
  it('inflates a deflate-raw stream and decodes the fixture', async () => {
    const t = scenarioTiny();
    await expect(readScenarioParcels(deflateRaw(encodeScenarioPayload(t)))).resolves.toEqual(t);
  });

  it('rejects a truncated compressed body with ScenarioFormatError', async () => {
    const z = new Uint8Array(
      await new Response(deflateRaw(encodeScenarioPayload(scenarioTiny()))).arrayBuffer()
    );
    const cut = z.subarray(0, z.length >> 1);
    await expect(readScenarioParcels(oneChunk(cut))).rejects.toThrow(ScenarioFormatError);
    await expect(readScenarioParcels(oneChunk(cut))).rejects.toThrow(/inflate failed/);
  });
});
