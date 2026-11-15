import { describe, expect, it } from 'vitest';
import { newId } from '$lib/ids/base58';
import { SHAPES_REVISION, type CommitDraft } from '$lib/sim-log';
import { DS, draftOf, nameChange, stamped } from '$lib/sim-store/test/commits';
import { FakeHub, settle } from './hub';

const frames = (texts: string[]) => texts.map((t) => JSON.parse(t));
const utf8 = (t: string) => new TextEncoder().encode(t).length;
const resume = (after: number) => JSON.stringify({ type: 'resume', after });
const append = (commit: unknown) => JSON.stringify({ type: 'append', commit });

function client(hub: FakeHub, sim: string) {
  const got: string[] = [];
  const codes: (number | undefined)[] = [];
  const ws = new hub.WebSocket(`ws://x/api/sims/${sim}/stream`);
  ws.addEventListener('message', (e) => got.push(String(e.data)));
  ws.addEventListener('close', (e) => codes.push(e.code));
  return { ws, got, codes };
}

/** An open, resumed socket on the sim (its hello, access and answer already read and cleared). */
function resumed(hub: FakeHub, sim: string) {
  const c = client(hub, sim);
  hub.flush();
  c.ws.send(resume(hub.commits(sim).length));
  hub.flush();
  c.got.length = 0;
  return c;
}

describe('FakeHub', () => {
  it('says hello and access, pages a resume with more, and marks resumed at the tip', () => {
    const hub = new FakeHub({ pageSize: 2 });
    const sim = newId();
    for (let s = 0; s < 3; s++) hub.foreign(sim, draftOf(s, [nameChange(`F${s}`)]));
    const { ws, got } = client(hub, sim);
    hub.flush();
    ws.send(JSON.stringify({ type: 'resume', after: 0 }));
    hub.flush();
    expect(hub.sockets[0].resumed).toBe(false);
    ws.send(JSON.stringify({ type: 'resume', after: 2 }));
    hub.flush();
    const f = frames(got);
    expect(f[0]).toEqual({ type: 'hello', build: 'b', protocol: 1, dataset: DS });
    expect(f[1]).toEqual({ type: 'access', write: true });
    expect(f[2]).toMatchObject({ more: true });
    expect(f[2].commits.map((c: { seq: number }) => c.seq)).toEqual([1, 2]);
    expect(f[3]).toMatchObject({ more: false });
    expect(hub.sockets[0].resumed).toBe(true);
    expect(hub.resumes).toEqual([0, 2]);
  });

  it('answers a duplicate with nothing, holds appends until release, and drops frames on close', () => {
    const hub = new FakeHub({ hold: true });
    const sim = newId();
    const d = draftOf(0, [nameChange('A')]);
    hub.foreign(sim, d);
    const { ws, got } = client(hub, sim);
    hub.flush();
    ws.send(JSON.stringify({ type: 'resume', after: 0 }));
    hub.flush();
    expect(got).toHaveLength(3); // hello, access, the answer holding A
    ws.send(JSON.stringify({ type: 'append', commit: d }));
    hub.flush();
    expect(hub.duplicates).toBe(0); // held
    hub.release();
    hub.flush();
    expect(hub.duplicates).toBe(1);
    expect(got).toHaveLength(3); // a duplicate is answered by nothing
    hub.foreign(sim, draftOf(1, [nameChange('B')])); // queued to the resumed socket
    hub.closeAll(1006);
    expect(hub.flush()).toBe(1); // the commit frame was lost; only the close is delivered
    expect(got).toHaveLength(3);
  });

  it('closes 1006 a socket for an unregistered sim when strict, and every socket when rejecting', () => {
    const hub = new FakeHub({ strict: true });
    const a = client(hub, newId());
    hub.flush();
    expect(a.codes).toEqual([1006]);
    const sim = newId();
    hub.register(sim);
    hub.reject = true;
    const b = client(hub, sim);
    hub.flush();
    expect(b.codes).toEqual([1006]);
  });

  it('answers ping with pong, and nothing at all while muted', () => {
    const hub = new FakeHub();
    const { ws, got } = client(hub, newId());
    hub.flush();
    ws.send('ping');
    hub.flush();
    expect(got.at(-1)).toBe('pong');
    hub.mute = true;
    ws.send('ping');
    hub.flush();
    hub.mute = false;
    hub.flush();
    expect(got.filter((t) => t === 'pong')).toHaveLength(1);
  });

  it('stores a raw commit unchecked and sends it to resumed sockets', () => {
    const hub = new FakeHub();
    const sim = newId();
    const { ws, got } = client(hub, sim);
    hub.flush();
    ws.send(JSON.stringify({ type: 'resume', after: 0 }));
    hub.flush();
    const later = stamped(draftOf(1, [nameChange('L')], { shapes: SHAPES_REVISION + 1 }), 2);
    hub.storeRaw(sim, later);
    hub.flush();
    expect(hub.commits(sim)[1]).toEqual(later);
    expect(frames(got).at(-1)).toEqual({ type: 'commits', commits: [later] });
  });

  it('writes hello from the options: another dataset, none, a build and a protocol', () => {
    const a = new FakeHub({ dataset: 'fixture-9', build: 'x', protocol: 2 });
    const ca = client(a, newId());
    a.flush();
    expect(frames(ca.got)[0]).toEqual({
      type: 'hello',
      build: 'x',
      protocol: 2,
      dataset: 'fixture-9'
    });
    const b = new FakeHub({ dataset: null });
    const cb = client(b, newId());
    b.flush();
    expect(frames(cb.got)[0]).toEqual({ type: 'hello', build: 'b', protocol: 1 });
    const s = new FakeHub({ write: false });
    s.silent = true;
    const cs = client(s, newId());
    s.flush();
    expect(frames(cs.got)).toEqual([{ type: 'access', write: false }]);
    expect(s.sockets[0].readyState).toBe(1);
  });

  it('answers a resume at the tip with an empty last frame, and past the tip refuses gone', () => {
    const hub = new FakeHub();
    const sim = newId();
    hub.foreign(sim, draftOf(0, [nameChange('A')]));
    const { ws, got } = client(hub, sim);
    hub.flush();
    ws.send(resume(1));
    hub.flush();
    expect(frames(got).at(-1)).toEqual({ type: 'commits', commits: [], more: false });
    expect(hub.sockets[0].resumed).toBe(true);
    ws.send(resume(5));
    hub.flush();
    expect(frames(got).at(-1)).toEqual({ type: 'refused', id: null, why: 'gone' });
    expect(hub.sockets[0].resumed).toBe(false); // a resume clears the mark; a refusal leaves it
  });

  it('refuses a second resume while one is outstanding, ahead of the answer, and then answers', () => {
    const hub = new FakeHub();
    const sim = newId();
    hub.foreign(sim, draftOf(0, [nameChange('A')]));
    const { ws, got } = client(hub, sim);
    hub.flush();
    got.length = 0;
    ws.send(resume(0));
    ws.send(resume(0));
    hub.flush();
    const f = frames(got);
    expect(f[0]).toEqual({ type: 'refused', id: null, why: 'limit' });
    expect(f[1]).toMatchObject({ type: 'commits', more: false });
    expect(hub.sockets[0].resumed).toBe(true);
    ws.send(resume(1));
    hub.flush();
    expect(frames(got).at(-1)).toEqual({ type: 'commits', commits: [], more: false });
    expect(hub.resumes).toEqual([0, 0, 1]);
  });

  it('refuses resumes on demand, in order, and a refused resume leaves the mark clear', () => {
    const hub = new FakeHub();
    const sim = newId();
    const { ws, got } = client(hub, sim);
    hub.flush();
    ws.send(resume(0));
    hub.flush();
    expect(hub.sockets[0].resumed).toBe(true);
    hub.refuseResume('limit', 'gone');
    got.length = 0;
    ws.send(resume(1));
    hub.flush();
    expect(hub.sockets[0].resumed).toBe(false);
    ws.send(resume(1));
    hub.flush();
    ws.send(resume(1));
    hub.flush();
    expect(frames(got)).toEqual([
      { type: 'refused', id: null, why: 'limit' },
      { type: 'refused', id: null, why: 'gone' },
      { type: 'commits', commits: [], more: false }
    ]);
    expect(hub.sockets[0].resumed).toBe(true);
  });

  it('sends live commits only to sockets caught up, the author included, never to the excepted', () => {
    const hub = new FakeHub({ pageSize: 1 });
    const sim = newId();
    hub.foreign(sim, draftOf(0, [nameChange('A')]));
    hub.foreign(sim, draftOf(1, [nameChange('B')]));
    const a = resumed(hub, sim);
    a.ws.send(resume(0)); // answer one commit of two: not caught up
    const b = client(hub, sim); // never resumed
    hub.flush();
    const c = resumed(hub, sim);
    a.got.length = 0;
    const d = draftOf(2, [nameChange('C')]);
    c.ws.send(append(d));
    hub.flush();
    expect(frames(c.got)).toHaveLength(1); // the author's own, as a live frame with no more
    expect(frames(c.got)[0]).toMatchObject({ type: 'commits', commits: [{ id: d.id, seq: 3 }] });
    expect(frames(c.got)[0]).not.toHaveProperty('more');
    expect(a.got).toEqual([]);
    expect(b.got.filter((t) => t.includes('"commits"'))).toEqual([]);
    const other = hub.foreign(sim, draftOf(3, [nameChange('D')]), { except: hub.sockets[2] });
    hub.flush();
    expect(other.seq).toBe(4);
    expect(c.got).toHaveLength(1);
  });

  it('answers appends as the object does: accepted, behind, invalid, not-writer, newer', () => {
    const hub = new FakeHub();
    const sim = newId();
    const a = resumed(hub, sim);
    const ok = draftOf(1, [nameChange('A')]);
    const behind = draftOf(0, [nameChange('B')]);
    const bad = draftOf(2, [{ op: 'set', key: 'nope', field: 'x', value: 1 }]);
    const newer = draftOf(2, [nameChange('N')], { shapes: SHAPES_REVISION + 1 });
    for (const d of [ok, behind, bad, newer]) a.ws.send(append(d));
    a.ws.send(append({ id: 'junk' }));
    hub.flush();
    const f = frames(a.got);
    expect(f[0]).toMatchObject({ type: 'commits', commits: [{ id: ok.id }] });
    expect(f.slice(1)).toEqual([
      { type: 'refused', id: behind.id, why: 'behind' },
      { type: 'refused', id: bad.id, why: 'invalid' },
      { type: 'refused', id: newer.id, why: 'newer' },
      { type: 'refused', id: 'junk', why: 'invalid' }
    ]);
    expect(hub.appends).toHaveLength(5);
    expect(hub.commits(sim)).toHaveLength(2);
    hub.setAccess(false);
    a.got.length = 0;
    const later = draftOf(2, [nameChange('Z')]);
    a.ws.send(append(later));
    hub.flush();
    expect(frames(a.got)).toEqual([
      { type: 'access', write: false },
      { type: 'refused', id: later.id, why: 'not-writer' }
    ]);
    hub.setAccess(false);
    expect(hub.flush()).toBe(0); // no change, no frame
    client(hub, sim);
    hub.flush();
    expect(frames(hub.sockets[1].sent)).toEqual([]);
    expect(hub.sockets[1].readyState).toBe(1);
  });

  it('refuses the next appends on demand without storing them, then answers normally', () => {
    const hub = new FakeHub();
    const sim = newId();
    const a = resumed(hub, sim);
    hub.refuseNext('limit', 'full');
    const d = draftOf(1, [nameChange('A')]);
    a.ws.send(append(d));
    a.ws.send(append(d));
    a.ws.send(append(d));
    hub.flush();
    expect(frames(a.got).slice(0, 2)).toEqual([
      { type: 'refused', id: d.id, why: 'limit' },
      { type: 'refused', id: d.id, why: 'full' }
    ]);
    expect(frames(a.got)[2]).toMatchObject({ type: 'commits', commits: [{ id: d.id }] });
    expect(hub.commits(sim)).toHaveLength(2);
    expect(hub.duplicates).toBe(0);
  });

  it('closes 1011 on an append when told, storing nothing', () => {
    const hub = new FakeHub();
    const sim = newId();
    const a = resumed(hub, sim);
    hub.closeOnAppend = 1;
    a.ws.send(append(draftOf(1, [nameChange('A')])));
    hub.flush();
    expect(a.codes).toEqual([1011]);
    expect(hub.commits(sim)).toHaveLength(1);
    expect(hub.closeOnAppend).toBe(0);
    expect(a.ws.readyState).toBe(3);
  });

  it('stores a held append after release although its socket closed, sending it to the others', () => {
    const hub = new FakeHub({ hold: true });
    const sim = newId();
    const a = resumed(hub, sim);
    const b = resumed(hub, sim);
    b.ws.send(append(draftOf(1, [nameChange('B')])));
    hub.flush();
    expect(hub.appends).toHaveLength(1);
    b.ws.close(1000);
    hub.flush();
    expect(hub.commits(sim)).toHaveLength(1);
    hub.release();
    hub.flush();
    expect(hub.commits(sim)).toHaveLength(2);
    expect(frames(a.got)).toMatchObject([{ type: 'commits', commits: [{ seq: 2 }] }]);
    expect(b.got).toEqual([]);
    expect(b.codes).toEqual([1000]);
  });

  it('records what the client sent, throws before open, and drops sends after close', () => {
    const hub = new FakeHub();
    const { ws } = client(hub, newId());
    expect(() => ws.send('ping')).toThrow(/Failed to execute/);
    hub.flush();
    ws.send('ping');
    ws.close(4000);
    ws.close(1000);
    ws.send('ping');
    expect(hub.sockets[0].sent).toEqual(['ping']);
    expect(hub.sockets[0].closedWith).toBe(4000);
    expect(hub.sockets[0].readyState).toBe(2);
    expect(hub.flush()).toBe(3); // the ping and the close arrive, the close event is delivered
    expect(hub.sockets[0].readyState).toBe(3);
  });

  it('closes 1008 on a frame that is not a client frame, and refuses an oversized text limit', () => {
    const hub = new FakeHub();
    const a = client(hub, newId());
    hub.flush();
    a.ws.send(append('x'.repeat(2_000_000)));
    hub.flush();
    expect(frames(a.got).at(-1)).toEqual({ type: 'refused', id: null, why: 'limit' });
    a.ws.send('{"type":"nonsense"}');
    hub.flush();
    expect(a.codes).toEqual([1008]);
  });

  it('steps one hop at a time and counts what it handled', () => {
    const hub = new FakeHub();
    const { ws, got } = client(hub, newId());
    expect(hub.step()).toBe(3); // open, hello, access
    ws.send(resume(0));
    expect(hub.step()).toBe(1); // the frame reaches the server
    expect(got).toHaveLength(2);
    expect(hub.step()).toBe(1); // the answer is made
    expect(got).toHaveLength(2);
    expect(hub.step()).toBe(1); // the answer reaches the client
    expect(got).toHaveLength(3);
    expect(hub.step()).toBe(0);
  });

  it('registers a new sim with 201 and a registered one with 200', () => {
    const hub = new FakeHub({ strict: true });
    const reg = hub.registrar();
    const id = newId();
    expect(reg(id)).toMatchObject({ status: 201 });
    expect(reg(id)).toMatchObject({ status: 200 });
    const { codes } = client(hub, id);
    hub.flush();
    expect(codes).toEqual([]);
  });

  it('dispatches emitted late events whatever the state', () => {
    const hub = new FakeHub();
    const { ws, got, codes } = client(hub, newId());
    ws.close(1000);
    hub.sockets[0].emit('message', 'late');
    hub.sockets[0].emit('close', 1006);
    expect(got).toEqual(['late']);
    expect(codes).toEqual([1006]);
  });

  it('delivers nothing while muted, the open included', () => {
    const hub = new FakeHub();
    hub.mute = true;
    const { got } = client(hub, newId());
    expect(hub.flush()).toBe(0);
    expect(got).toEqual([]);
    expect(hub.sockets[0].readyState).toBe(0);
  });

  it('settles when nothing moves, waits on the stores, and throws when it never rests', async () => {
    const hub = new FakeHub();
    let writes = 0;
    const store = {
      async written() {
        writes += 1;
      }
    };
    const { ws, got } = client(hub, newId());
    ws.addEventListener('open', () => ws.send(resume(0)));
    await settle(hub, store);
    expect(frames(got).at(-1)).toMatchObject({ type: 'commits', more: false });
    expect(writes).toBeGreaterThanOrEqual(3);
    const busy = client(hub, newId());
    const restless = { written: async () => busy.ws.send('ping') };
    await expect(settle(hub, restless)).rejects.toThrow('no quiescence');
  });

  it('records an append frame as it was sent', () => {
    const hub = new FakeHub();
    const sim = newId();
    const a = resumed(hub, sim);
    const d: CommitDraft = draftOf(1, [nameChange('A')]);
    a.ws.send(append(d));
    hub.flush();
    expect(hub.appends).toEqual([d]);
  });

  it('stores a start commit when a writer opens an empty sim, before any resume is answered', () => {
    const hub = new FakeHub({ title: 'Mine' });
    const sim = newId();
    const a = client(hub, sim);
    hub.flush();
    a.ws.send(resume(0));
    hub.flush();
    const last = frames(a.got).at(-1);
    expect(last.more).toBe(false);
    expect(last.commits).toHaveLength(1);
    expect(last.commits[0]).toMatchObject({
      seq: 1,
      parent: 0,
      kind: 'system',
      label: 'Start',
      source: 'sim.start',
      datasetVersion: DS,
      build: 'b',
      shapes: SHAPES_REVISION,
      changes: [{ op: 'set', key: 'sim', field: 'name', value: 'Mine' }]
    });
    const mine = draftOf(0, [nameChange('M')]);
    a.ws.send(append(mine));
    hub.flush();
    expect(frames(a.got).at(-1)).toEqual({ type: 'refused', id: mine.id, why: 'behind' });
    const again = client(hub, sim); // a second open adds no second start
    hub.flush();
    expect(again.got).toHaveLength(2);
    expect(hub.commits(sim)).toHaveLength(1);
  });

  it('stores no start commit for a reader, or when turned off', () => {
    const reader = new FakeHub({ write: false });
    const sim = newId();
    client(reader, sim);
    reader.flush();
    expect(reader.commits(sim)).toEqual([]);
    const off = new FakeHub({ start: false });
    client(off, sim);
    off.flush();
    expect(off.commits(sim)).toEqual([]);
  });

  it('refuses limit a text over the frame size in bytes, naming the commit', () => {
    const hub = new FakeHub();
    const a = resumed(hub, newId());
    a.ws.send(append({ id: 'wide', pad: 'é'.repeat(600_000) })); // 600k chars, 1.2 MB
    hub.flush();
    expect(frames(a.got)).toEqual([{ type: 'refused', id: 'wide', why: 'limit' }]);
  });

  it('refuses limit a commit that is over the commit size once stamped', () => {
    const hub = new FakeHub();
    const sim = newId();
    const a = resumed(hub, sim);
    // Sized so that a stamp of the fake object's (about 100 bytes) fits and one with a 64-character
    // actor and a 13-digit time (about 70 bytes more) does not.
    const limit = 1_048_576 - 30;
    const rowSize = (changes: ReturnType<typeof nameChange>[]) =>
      utf8(JSON.stringify(stamped(draftOf(1, changes), 2)));
    const pad = nameChange('xxxxx');
    const unit = utf8(JSON.stringify(pad)) + 1;
    const n = Math.floor((limit - rowSize([nameChange('x')])) / unit);
    const pads = Array.from({ length: n }, () => pad);
    const k = 1 + limit - rowSize([nameChange('x'), ...pads]);
    const big = draftOf(1, [nameChange('x'.repeat(k)), ...pads]);
    expect(rowSize(big.changes)).toBe(limit);
    expect(utf8(append(big))).toBeLessThan(1_052_672); // under the frame size
    a.ws.send(append(big));
    hub.flush();
    expect(frames(a.got)).toEqual([{ type: 'refused', id: big.id, why: 'limit' }]);
    expect(hub.commits(sim)).toHaveLength(1);
  });

  it('judges a held append by the access its socket had when the frame arrived', () => {
    const hub = new FakeHub({ hold: true });
    const sim = newId();
    const a = resumed(hub, sim);
    a.ws.send(append(draftOf(1, [nameChange('A')])));
    hub.flush();
    hub.setAccess(false);
    hub.release();
    hub.flush();
    expect(hub.commits(sim)).toHaveLength(2);
    expect(frames(a.got).map((f) => f.type)).toEqual(['access', 'commits']);
  });

  it('splits a resume answer into frames, only the last carrying more', () => {
    const hub = new FakeHub({ frameSize: 1, pageSize: 3 });
    const sim = newId();
    for (let i = 0; i < 4; i++) hub.foreign(sim, draftOf(i, [nameChange(`F${i}`)]));
    const a = client(hub, sim);
    hub.flush();
    a.got.length = 0;
    a.ws.send(resume(0));
    hub.flush();
    const f = frames(a.got);
    expect(f.map((x) => x.commits.length)).toEqual([1, 1, 1]);
    expect(f[0]).not.toHaveProperty('more');
    expect(f[1]).not.toHaveProperty('more');
    expect(f[2].more).toBe(true);
    expect(hub.sockets[0].resumed).toBe(false);
    a.ws.send(resume(3));
    hub.flush();
    expect(frames(a.got).at(-1)).toMatchObject({ more: false });
    expect(hub.sockets[0].resumed).toBe(true);
  });

  it('answers appends after a stored row from a newer build as newer, behind first', () => {
    const hub = new FakeHub();
    const sim = newId();
    const a = resumed(hub, sim);
    hub.storeRaw(sim, stamped(draftOf(1, [nameChange('L')], { shapes: SHAPES_REVISION + 1 }), 2));
    hub.flush();
    a.got.length = 0;
    const next = draftOf(2, [nameChange('N')]);
    const behind = draftOf(0, [nameChange('B')]);
    a.ws.send(append(next));
    a.ws.send(append(behind));
    hub.flush();
    expect(frames(a.got)).toEqual([
      { type: 'refused', id: next.id, why: 'newer' },
      { type: 'refused', id: behind.id, why: 'behind' }
    ]);
    expect(hub.commits(sim)).toHaveLength(2);
  });

  it('closes 1011 an append after a stored row that does not fold', () => {
    const hub = new FakeHub();
    const sim = newId();
    const a = resumed(hub, sim);
    hub.storeRaw(sim, stamped(draftOf(1, [{ op: 'set', key: 'nope', field: 'x', value: 1 }]), 2));
    a.ws.send(append(draftOf(2, [nameChange('N')])));
    hub.flush();
    expect(a.codes).toEqual([1011]);
  });

  it('takes a queued refusal at its place in the real order of checks', () => {
    const hub = new FakeHub();
    const sim = newId();
    const a = resumed(hub, sim);
    const first = draftOf(1, [nameChange('A')]);
    a.ws.send(append(first));
    hub.flush();
    a.got.length = 0;
    hub.refuseNext('full', 'behind');
    a.ws.send(append(first)); // a duplicate stays silent and leaves the queue alone
    hub.flush();
    expect(a.got).toEqual([]);
    expect(hub.duplicates).toBe(1);
    const fresh = draftOf(2, [nameChange('B')]);
    a.ws.send(append(fresh));
    a.ws.send(append(fresh));
    hub.flush();
    expect(frames(a.got)).toEqual([
      { type: 'refused', id: fresh.id, why: 'full' },
      { type: 'refused', id: fresh.id, why: 'behind' }
    ]);
    hub.refuseNext('gone', 'limit');
    hub.setAccess(false);
    a.got.length = 0;
    a.ws.send(append(fresh)); // a queued gone answers even a reader, before not-writer
    hub.flush();
    expect(frames(a.got)).toEqual([
      { type: 'access', write: false },
      { type: 'refused', id: fresh.id, why: 'gone' }
    ]);
    a.ws.send(append(fresh)); // a reader is not-writer before the rate step
    hub.flush();
    expect(frames(a.got).at(-1)).toEqual({ type: 'refused', id: fresh.id, why: 'not-writer' });
  });

  it('handles frames of one sim in arrival order across sockets', () => {
    const hub = new FakeHub();
    const sim = newId();
    const a = resumed(hub, sim);
    const b = resumed(hub, sim);
    a.ws.send(resume(1));
    const d = draftOf(1, [nameChange('B')]);
    b.ws.send(append(d));
    hub.flush();
    expect(frames(a.got)).toMatchObject([
      { type: 'commits', commits: [], more: false },
      { type: 'commits', commits: [{ id: d.id }] }
    ]);
  });

  it('puts a closing socket in CLOSING, then fires its own close once with a browser code', () => {
    const hub = new FakeHub();
    const b = client(hub, newId());
    const c = client(hub, newId());
    hub.flush();
    b.ws.close();
    expect(hub.sockets[0].readyState).toBe(2);
    expect(b.codes).toEqual([]);
    b.ws.send('ping');
    expect(hub.sockets[0].sent).toEqual([]);
    hub.flush();
    expect(b.codes).toEqual([1000]); // the object replies 1000 to a close with no code
    expect(hub.sockets[0].readyState).toBe(3);
    c.ws.close(4001);
    hub.closeAll(1011); // a server close after the client's close adds no second event
    hub.flush();
    expect(c.codes).toEqual([4001]);
    expect(b.got.filter((t) => t === 'pong')).toEqual([]);
  });

  it('reports 1006 for a socket closed while connecting, and rejects a bad close code', () => {
    const hub = new FakeHub();
    const a = client(hub, newId());
    const events: string[] = [];
    hub.sockets[0].addEventListener('error', () => events.push('error'));
    hub.sockets[0].addEventListener('close', () => events.push('close'));
    a.ws.close(1000);
    hub.flush();
    expect(a.codes).toEqual([1006]);
    expect(events).toEqual(['error', 'close']);
    expect(a.got).toEqual([]);
    const long = '\u00e9'.repeat(70); // 70 characters, 140 bytes
    const toolong = client(hub, newId());
    expect(() => toolong.ws.close(1000, long)).toThrow(
      expect.objectContaining({ name: 'SyntaxError' })
    );
    const ok = client(hub, newId());
    expect(() => ok.ws.close(1000, 'x'.repeat(123))).not.toThrow();
    expect(() => client(hub, newId()).ws.close(1011)).toThrow(/close code/);
  });

  it('answers a queued invalid at the fold: after duplicate, behind and the others', () => {
    const hub = new FakeHub();
    const sim = newId();
    const a = resumed(hub, sim);
    const first = draftOf(1, [nameChange('A')]);
    a.ws.send(append(first));
    hub.flush();
    a.got.length = 0;
    hub.refuseNext('invalid');
    a.ws.send(append(first)); // a duplicate stays silent
    const old = draftOf(0, [nameChange('O')]);
    a.ws.send(append(old)); // an old parent is behind
    hub.flush();
    expect(frames(a.got)).toEqual([{ type: 'refused', id: old.id, why: 'behind' }]);
    const tip = draftOf(2, [nameChange('T')]);
    a.ws.send(append(tip)); // on the tip it reaches the fold
    hub.flush();
    expect(frames(a.got).at(-1)).toEqual({ type: 'refused', id: tip.id, why: 'invalid' });
    expect(hub.commits(sim)).toHaveLength(2);
    expect(hub.duplicates).toBe(1);
  });

  it('closes 1011 on closeOnAppend only after the fold check passed', () => {
    const hub = new FakeHub();
    const sim = newId();
    const a = resumed(hub, sim);
    hub.closeOnAppend = 1;
    const bad = draftOf(1, [{ op: 'set', key: 'nope', field: 'x', value: 1 }]);
    a.ws.send(append(bad));
    hub.flush();
    expect(frames(a.got)).toEqual([{ type: 'refused', id: bad.id, why: 'invalid' }]);
    expect(hub.closeOnAppend).toBe(1);
    a.ws.send(append(draftOf(1, [nameChange('A')])));
    hub.flush();
    expect(a.codes).toEqual([1011]);
  });

  describe('with a stored row that folds', () => {
    const metro = {
      id: 'z1',
      kind: 'zoning',
      where: { tag: 'transit', stopTypes: ['metro'] },
      label: 'Metro',
      preset: null,
      on: true
    };
    const addMetro = {
      op: 'add',
      key: 'p:z1',
      shape: 'policy.transit',
      fields: metro,
      after: null
    };
    const turnOff = { op: 'set', key: 'p:z1', field: 'on', value: false };

    function withRow() {
      const hub = new FakeHub();
      const sim = newId();
      const a = resumed(hub, sim); // the start commit is seq 1
      hub.storeRaw(sim, stamped(draftOf(1, [addMetro as never]), 2));
      hub.flush();
      a.got.length = 0;
      return { hub, sim, a };
    }

    it('accepts and stores a draft that edits what the raw row made', () => {
      const { hub, sim, a } = withRow();
      const d = draftOf(2, [turnOff as never]);
      a.ws.send(append(d));
      hub.flush();
      expect(frames(a.got)).toMatchObject([{ type: 'commits', commits: [{ id: d.id, seq: 3 }] }]);
      expect(hub.commits(sim)).toHaveLength(3);
    });

    it('refuses invalid a draft that conflicts with what the raw row made', () => {
      const { hub, sim, a } = withRow();
      const d = draftOf(2, [addMetro as never]);
      a.ws.send(append(d));
      hub.flush();
      expect(frames(a.got)).toEqual([{ type: 'refused', id: d.id, why: 'invalid' }]);
      expect(hub.commits(sim)).toHaveLength(2);
    });

    it('judges foreign commits by the same fold', () => {
      const { hub, sim } = withRow();
      const ok = hub.foreign(sim, draftOf(2, [turnOff as never]));
      expect(ok.seq).toBe(3);
      expect(() => hub.foreign(sim, draftOf(3, [turnOff as never]))).not.toThrow();
      expect(() => hub.foreign(sim, draftOf(4, [addMetro as never]))).toThrow(/not accepted/);
    });
  });

  it("still delivers the client's own close while muted", () => {
    const hub = new FakeHub();
    const a = client(hub, newId());
    hub.flush();
    hub.mute = true;
    a.ws.close(1000);
    hub.flush();
    expect(a.codes).toEqual([1000]);
  });

  it('closes 1003 on a binary message, 1008 on a malformed after, and carries 4410', () => {
    const hub = new FakeHub();
    const a = client(hub, newId());
    const b = client(hub, newId());
    const c = client(hub, newId());
    hub.flush();
    (a.ws.send as (d: unknown) => void)(new ArrayBuffer(4));
    b.ws.send('{"type":"resume","after":-1}');
    hub.flush();
    hub.closeAll(4410);
    hub.flush();
    expect(a.codes).toEqual([1003]);
    expect(b.codes).toEqual([1008]);
    expect(c.codes).toEqual([4410]);
  });
});
