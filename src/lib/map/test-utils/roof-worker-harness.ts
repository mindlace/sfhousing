// A real module Worker runs the production handler. Only the HTTP/hash boundaries are controlled.
import '../roof-worker';
interface TestWorkerScope {
  fetch: typeof fetch;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}
const scope = self as unknown as TestWorkerScope;
const post = scope.postMessage.bind(scope);
let held: (() => void) | undefined;
const digest = crypto.subtle.digest.bind(crypto.subtle);
scope.addEventListener('message', (event) => {
  if (event.data.type === 'release-hash') {
    held?.();
    return;
  }
  if (event.data.type !== 'fixture') return;
  const { header, mesh, holdHash } = event.data as {
    header: Uint8Array<ArrayBuffer>;
    mesh: Uint8Array<ArrayBuffer>;
    holdHash: boolean;
  };
  scope.fetch = async (input, _init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          const bytes = String(input).endsWith('.json') ? header : mesh;
          for (let i = 0; i < bytes.length; i += 19) controller.enqueue(bytes.slice(i, i + 19));
          controller.close();
        }
      })
    );
  if (holdHash)
    crypto.subtle.digest = async (...args: Parameters<SubtleCrypto['digest']>) => {
      await new Promise<void>((resolve) => {
        held = resolve;
        post({ type: 'hash-held' });
      });
      return digest(...args);
    };
  scope.postMessage = ((message: unknown, transfer?: Transferable[]) => {
    post(message, transfer ?? []);
    if (transfer?.length)
      post({
        type: 'transfer-proof',
        lengths: transfer.map((buffer) => (buffer as ArrayBuffer).byteLength)
      });
  }) as typeof scope.postMessage;
  post({ type: 'fixture-ready' });
});
