import { describe, expect, it } from 'vitest';
import { newId } from '$lib/ids/base58';
import { REGISTER_LOCK, RegisterGate, registerAnswerOf, registerSim } from './register';
import type { LocksLike } from './ports';
import { FakeClock, FakeFetch, FakeLocks, microtasks } from './test/fakes';

const id = newId();

describe('registerAnswerOf', () => {
  it.each([
    [201, { simId: id, created: true }, { kind: 'ok', created: true }],
    [200, { simId: id, created: false }, { kind: 'ok', created: false }],
    [200, { simId: newId(), created: false }, { kind: 'bug', status: 200, code: null }],
    [401, { error: 'x', code: 'sign_in' }, { kind: 'sign-in' }],
    [409, { error: 'x', code: 'taken' }, { kind: 'taken' }],
    [403, { error: 'x', code: 'quota' }, { kind: 'quota' }],
    [403, { error: 'x' }, { kind: 'bug', status: 403, code: null }],
    [429, { error: 'x', code: 'rate' }, { kind: 'retry' }],
    [500, { error: 'x', code: 'failed' }, { kind: 'retry' }],
    [500, { error: 'x', code: 'session' }, { kind: 'retry' }],
    [500, { message: 'x' }, { kind: 'retry' }],
    [503, null, { kind: 'retry' }],
    [400, { error: 'x', code: 'invalid_id' }, { kind: 'bug', status: 400, code: 'invalid_id' }],
    [400, { error: 'x', code: 'title' }, { kind: 'bug', status: 400, code: 'title' }],
    [400, { error: 'x', code: 'nonsense' }, { kind: 'bug', status: 400, code: null }],
    [415, { error: 'x' }, { kind: 'bug', status: 415, code: null }],
    [404, null, { kind: 'bug', status: 404, code: null }]
  ] as const)('%i %j answers %j', (status, body, want) => {
    expect(registerAnswerOf(id, status, body)).toEqual(want);
  });

  it.each([200, 201])('a %i with no body or a body of the wrong shape is retry', (status) => {
    for (const body of [null, 'x', {}, { simId: id }, { simId: id, created: 'yes' }]) {
      expect(registerAnswerOf(id, status, body)).toEqual({ kind: 'retry' });
    }
  });

  it.each([200, 201])('a %i naming another sim is a bug, not retry', (status) => {
    expect(registerAnswerOf(id, status, { simId: newId(), created: true })).toEqual({
      kind: 'bug',
      status,
      code: null
    });
  });
});

describe('registerSim', () => {
  it('posts only the id, as JSON, to /api/sims, and cancels its timer on the answer', async () => {
    const clock = new FakeClock();
    const f = new FakeFetch(() => ({ status: 201, body: { simId: id, created: true } }));
    expect(await registerSim(f.fetch, id, clock)).toEqual({ kind: 'ok', created: true });
    expect(f.calls).toEqual([
      {
        url: '/api/sims',
        method: 'POST',
        contentType: 'application/json',
        headers: { 'content-type': 'application/json' },
        body: { simId: id }
      }
    ]);
    expect(clock.nextDelay()).toBeNull();
  });

  it('a network failure is retry, and a body that is not JSON is no body', async () => {
    const clock = new FakeClock();
    const f = new FakeFetch(() => 'network');
    expect(await registerSim(f.fetch, id, clock)).toEqual({ kind: 'retry' });
    expect(clock.nextDelay()).toBeNull();
    f.handler = () => ({ status: 201 });
    expect(await registerSim(f.fetch, id, clock)).toEqual({ kind: 'retry' });
    expect(clock.nextDelay()).toBeNull();
    f.handler = () => ({ status: 404 });
    expect(await registerSim(f.fetch, id, clock)).toEqual({ kind: 'bug', status: 404, code: null });
  });

  it('a body that cannot be read clears the timer and is retry on a 201', async () => {
    const clock = new FakeClock();
    const body = new ReadableStream({
      pull: (c) => c.error(new TypeError('cut'))
    });
    const res = new Response(body, { status: 201 });
    expect(await registerSim(() => Promise.resolve(res), id, clock)).toEqual({ kind: 'retry' });
    expect(clock.nextDelay()).toBeNull();
  });

  it('a response that arrives after the abort changes nothing', async () => {
    const clock = new FakeClock();
    let late: (a: { status: number; body: unknown }) => void = () => {};
    const f = new FakeFetch(() => new Promise((resolve) => (late = resolve as typeof late)));
    const answers: unknown[] = [];
    void registerSim(f.fetch, id, clock).then((a) => answers.push(a));
    await microtasks();
    clock.advance(30_000);
    await microtasks();
    late({ status: 201, body: { simId: id, created: true } });
    await microtasks();
    expect(answers).toEqual([{ kind: 'retry' }]);
    expect(f.inFlight).toBe(0);
    expect(clock.nextDelay()).toBeNull();
  });

  it('a request with no answer in 30 s is aborted and is retry (F10)', async () => {
    const clock = new FakeClock();
    const f = new FakeFetch(() => new Promise(() => {}));
    let answer: unknown = null;
    void registerSim(f.fetch, id, clock).then((a) => (answer = a));
    await microtasks();
    clock.advance(29_999);
    await microtasks();
    expect(answer).toBeNull();
    clock.advance(1);
    await microtasks();
    expect(answer).toEqual({ kind: 'retry' });
    expect(f.inFlight).toBe(0);
  });
});

describe('RegisterGate', () => {
  async function oneAtATime(locks: FakeLocks | null) {
    const a = new RegisterGate(locks);
    const b = new RegisterGate(locks);
    let inside = 0;
    let most = 0;
    const releases: (() => void)[] = [];
    const job = () =>
      new Promise<void>((resolve) => {
        inside++;
        most = Math.max(most, inside);
        releases.push(() => {
          inside--;
          resolve();
        });
      });
    const runs = locks ? [a.run(job), b.run(job), a.run(job)] : [a.run(job), a.run(job)];
    for (let i = 0; i < runs.length; i++) {
      await microtasks();
      expect(releases).toHaveLength(i + 1);
      releases[i]();
    }
    await Promise.all(runs);
    expect(most).toBe(1);
  }

  it('runs one registration at a time across tabs sharing Web Locks', async () => {
    const locks = new FakeLocks();
    await oneAtATime(locks);
    expect(new Set(locks.requested)).toEqual(new Set([REGISTER_LOCK]));
  });

  it('runs one at a time in this tab without Web Locks', async () => {
    await oneAtATime(null);
  });

  it('a job that throws lets the next one run', async () => {
    const gate = new RegisterGate(new FakeLocks());
    await expect(gate.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await gate.run(async () => 'next')).toBe('next');
  });

  it('the lock is free after a job resolves and after a job throws', async () => {
    const locks = new FakeLocks();
    const gate = new RegisterGate(locks);
    await gate.run(async () => 1);
    expect(locks.held()).toEqual([]);
    await expect(gate.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(locks.held()).toEqual([]);
  });

  it('a Web Locks request that rejects falls back to the tab chain, for later jobs too', async () => {
    const calls: string[] = [];
    const broken: LocksLike = {
      request: (name) => {
        calls.push(name);
        return Promise.reject(new DOMException('opaque', 'SecurityError'));
      },
      query: () => Promise.reject(new DOMException('opaque', 'SecurityError'))
    };
    const gate = new RegisterGate(broken);
    expect(await gate.run(async () => 'one')).toBe('one');
    expect(await gate.run(async () => 'two')).toBe('two');
    await expect(gate.run(() => Promise.reject(new Error('mine')))).rejects.toThrow('mine');
    expect(await gate.run(async () => 'three')).toBe('three');
    expect(calls).toEqual([REGISTER_LOCK]);
  });

  it('a job that throws lets the next one run without Web Locks', async () => {
    const gate = new RegisterGate(null);
    const first = gate.run(async () => Promise.reject(new Error('x')));
    const second = gate.run(async () => 'next');
    await expect(first).rejects.toThrow('x');
    expect(await second).toBe('next');
  });
});
