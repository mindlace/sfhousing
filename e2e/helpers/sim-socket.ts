// A websocket client for e2e specs: the page's own WebSocket (Playwright's request context cannot
// open one), so the session cookie and the app's CSP apply. Every received frame is kept in
// window.__sfhSockets; specs wait on frame counts, never on time.
import { expect, type Page } from '@playwright/test';
import type { Commit, CommitDraft } from '../../src/lib/sim-log/types';
import type { ClientFrame, ServerFrame } from '../../src/lib/sim-stream/protocol';
import { newId } from '../../src/lib/ids/base58';

type Entry = { ws: WebSocket; frames: ServerFrame[]; closed: number | null };
declare global {
  interface Window {
    __sfhSockets?: Entry[];
  }
}

/** A frame a spec may send: any client frame, or an append whose commit is anything. */
export type AnyClientFrame = ClientFrame | { type: 'append'; commit: unknown };

/** Open a socket on the sim from the page's origin; returns its handle. */
export async function openSimSocket(page: Page, simId: string): Promise<number> {
  return page.evaluate((id) => {
    const list = (window.__sfhSockets ??= []);
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/api/sims/${id}/stream`);
    const entry: Entry = { ws, frames: [], closed: null };
    ws.addEventListener('message', (e) => entry.frames.push(JSON.parse(String(e.data))));
    ws.addEventListener('close', (e) => {
      entry.closed = e.code;
    });
    list.push(entry);
    return list.length - 1;
  }, simId);
}

/** Wait until socket `h` has received at least `n` frames; returns all of them. */
export async function framesAtLeast(page: Page, h: number, n: number): Promise<ServerFrame[]> {
  await page.waitForFunction(([i, k]) => (window.__sfhSockets?.[i]?.frames.length ?? 0) >= k, [
    h,
    n
  ] as const);
  return page.evaluate((i) => window.__sfhSockets![i].frames, h);
}

/** Send a frame once the socket is open. `commit` may be anything, to test refusals. */
export async function sendFrame(page: Page, h: number, frame: AnyClientFrame): Promise<void> {
  await page.waitForFunction((i) => window.__sfhSockets?.[i]?.ws.readyState === 1, h);
  await page.evaluate(([i, text]) => window.__sfhSockets![i].ws.send(text), [
    h,
    JSON.stringify(frame)
  ] as const);
}

/** Send `frame` and return the next frame this socket receives. */
export async function sendAndRead(
  page: Page,
  h: number,
  frame: AnyClientFrame
): Promise<ServerFrame> {
  const before = (await framesAtLeast(page, h, 0)).length;
  await sendFrame(page, h, frame);
  return (await framesAtLeast(page, h, before + 1))[before];
}

/** Resume after `after` and return the answer (one frame: e2e logs are small). */
export const resumeAndRead = (page: Page, h: number, after: number): Promise<ServerFrame> =>
  sendAndRead(page, h, { type: 'resume', after });

/** Wait for socket `h` to close; returns the close code. */
export async function closedCode(page: Page, h: number): Promise<number> {
  await page.waitForFunction((i) => window.__sfhSockets?.[i]?.closed !== null, h);
  return page.evaluate((i) => window.__sfhSockets![i].closed!, h);
}

/** The commits of a `commits` frame (fails the test for any other frame). */
export function commitsOf(frame: ServerFrame): Commit[] {
  expect(frame.type).toBe('commits');
  return frame.type === 'commits' ? frame.commits : [];
}

/**
 * A valid edit setting the sim's name. Duplicates nameDraft in
 * src/lib/server/sim-object/test/drafts.ts because Playwright cannot resolve $lib; `shapes: 1` is
 * SHAPES_REVISION today (src/lib/sim-log/shapes.ts).
 */
export function nameDraft(
  parent: number,
  name: string,
  over: Partial<CommitDraft> = {}
): CommitDraft {
  return {
    id: newId(),
    parent,
    kind: 'edit',
    label: 'Rename',
    restores: null,
    datasetVersion: 'fixture-0',
    shapes: 1,
    build: 'e2e',
    source: 'sim.name',
    changes: [{ op: 'set', key: 'sim', field: 'name', value: name }],
    ...over
  };
}
