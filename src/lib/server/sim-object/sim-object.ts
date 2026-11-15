// The sim's Durable Object: one per sim, named by the sim id (R21, R23). Wiring only: every rule
// it applies lives in the modules beside it and is tested in Node; this file connects them to
// the platform (hibernating websockets, SQLite storage, the alarm, D1). Bundled by wrangler from
// source, so nothing reachable from here may import $app/*, $env/* or a build-time global.
import { DurableObject } from 'cloudflare:workers';
import { safeMigrate } from '@planafoot/drizzle-cf-migrations/do';
import { drizzle as d1Drizzle } from 'drizzle-orm/d1';
import { drizzle as durableDrizzle } from 'drizzle-orm/durable-sqlite';
import { newId } from '$lib/ids/base58';
import type { Database } from '$lib/server/db';
import * as d1Schema from '$lib/server/db/schema';
import { foldSimRole } from '$lib/server/sims/sim-roles';
import {
  CLOSE_GONE,
  CLOSE_INTERNAL,
  PING,
  PONG,
  PROTOCOL,
  commitsFrame,
  encodeFrame
} from '$lib/sim-stream/protocol';
import { canWrite, parseAttachment } from './access';
import { syncSimIndex } from './index-sync';
import { INDEX_BATCH, INDEX_RETRY_MS } from './limits';
import { LogHost } from './log-host';
import { simMigrations } from './migrations.generated';
import {
  closeReply,
  distinctIdentities,
  loggable,
  openStatus,
  readMessage,
  roleChanges
} from './object-rules';
import { OPEN_HEADER, parseOpenParams } from './open-params';
import * as schema from './schema';
import { SimStore, type SimDb } from './store';

export class SimObject extends DurableObject<Env> {
  #host: LogHost | null = null;
  #migrateError: Error | null = null;
  #indexing = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    void ctx.blockConcurrencyWhile(async () => {
      // A throw here would reset the object; it must still construct so it stays destroyable.
      let host: LogHost;
      try {
        const durable = durableDrizzle(ctx.storage, { schema });
        this.#migrateError = safeMigrate(
          durable as unknown as Parameters<typeof safeMigrate>[0],
          simMigrations
        );
        if (this.#migrateError) {
          console.error('[sim-object] migrate failed', this.#label(), loggable(this.#migrateError));
          return;
        }
        host = new LogHost(new SimStore(durable as unknown as SimDb), {
          label: this.#label(),
          onCommit: (body) => this.#broadcast(commitsFrame([body]))
        });
      } catch (e) {
        // The storage cannot be opened: the object answers 503.
        console.error('[sim-object] open failed', this.#label(), loggable(e));
        return;
      }
      this.#host = host;
      try {
        if (host.indexBehind() && (await ctx.storage.getAlarm()) === null) {
          await ctx.storage.setAlarm(Date.now());
        }
      } catch (e) {
        // The host stays: the next accepted commit kicks the index again.
        console.error('[sim-object] index alarm not set', this.#label(), loggable(e));
      }
    });
  }

  /** The websocket open. Requires the Upgrade header and OPEN_HEADER (set by the route only). */
  async fetch(request: Request): Promise<Response> {
    const host = this.#host;
    const params = parseOpenParams(request.headers.get(OPEN_HEADER));
    const status = openStatus({
      upgrade: request.headers.get('Upgrade'),
      params,
      simId: this.ctx.id.name,
      host: host !== null,
      gone: host?.gone() ?? false
    });
    if (status !== null || !host || !params) {
      return new Response(null, { status: status ?? 500 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ identity: params.identity, write: params.write, resumed: false });
    server.send(encodeFrame({ type: 'hello', build: params.build, protocol: PROTOCOL }));
    server.send(encodeFrame({ type: 'access', write: params.write }));
    // R58: a writer opening an empty sim records its first commit. This socket is not resumed
    // yet, so the commit reaches it in its own resume answer (decision 14).
    if (params.write && params.identity !== null && host.tip() === 0) {
      try {
        const out = await host.ensureStarted({
          id: newId(),
          title: params.title,
          actor: params.identity,
          datasetVersion: params.datasetVersion,
          build: params.build,
          now: Date.now()
        });
        if (out?.kind === 'accepted') this.ctx.waitUntil(this.#kickIndex());
      } catch (e) {
        console.error('[sim-object] start failed', this.#label(), loggable(e));
        this.#close(server, CLOSE_INTERNAL, 'internal');
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer): Promise<void> {
    const host = this.#host;
    if (!host) return this.#close(ws, CLOSE_INTERNAL, 'internal');
    const read = readMessage(msg, ws.deserializeAttachment());
    if (read.kind === 'close') return this.#close(ws, read.code, read.reason);
    if (read.kind === 'oversized') {
      return this.#send(ws, encodeFrame({ type: 'refused', id: null, why: 'limit' }));
    }
    const { frame, attachment, bytes } = read;
    if (frame.type === 'resume') {
      let marked = false;
      try {
        await host.resume(frame.after, (frames) => {
          if (frames === null) {
            this.#send(ws, encodeFrame({ type: 'refused', id: null, why: 'gone' }));
            return;
          }
          for (const f of frames) this.#send(ws, f);
          // On the first page: live commits stored after it reach this socket in order (I7).
          if (!marked) {
            marked = true;
            this.#markResumed(ws);
          }
        });
      } catch (e) {
        console.error('[sim-object] resume failed', this.#label(), loggable(e));
        this.#close(ws, CLOSE_INTERNAL, 'internal');
      }
      return;
    }
    try {
      const out = await host.append(
        frame.commit,
        frame.id,
        bytes,
        { identity: attachment.identity, write: attachment.write },
        Date.now()
      );
      if (out.kind === 'refused') {
        this.#send(ws, encodeFrame({ type: 'refused', id: out.id, why: out.why }));
      } else if (out.kind === 'accepted') {
        // The commit itself already went out through onCommit.
        await this.#kickIndex();
      }
    } catch (e) {
      console.error('[sim-object] append failed', this.#label(), loggable(e));
      this.#close(ws, CLOSE_INTERNAL, 'internal');
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    wasClean: boolean
  ): Promise<void> {
    // compatibility_date 2026-03-01 predates web_socket_auto_reply_to_close (2026-04-07): the
    // object completes the close handshake itself, never with a reserved code (closeReply).
    this.#close(ws, closeReply(code), reason);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    // A close follows.
  }

  /** Retries the index write (R41). */
  async alarm(): Promise<void> {
    await this.#kickIndex();
  }

  /**
   * RPC for unit 3's roster hook (R53): re-read each open socket's role and send access on
   * change.
   */
  async rereadRoles(): Promise<void> {
    const simId = this.ctx.id.name;
    if (!simId) return;
    const identities = distinctIdentities(
      this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment())
    );
    if (identities.length === 0) return;
    let writers: Map<string, boolean>;
    try {
      const db = this.#d1();
      const read = await Promise.all(
        identities.map(async (id) => [id, canWrite(await foldSimRole(db, simId, id))] as const)
      );
      writers = new Map(read);
    } catch (e) {
      // Rights stay as they were; the caller's next call retries.
      console.error('[sim-object] role read failed', simId, loggable(e));
      return;
    }
    const sockets = this.ctx.getWebSockets();
    const changes = roleChanges(
      sockets.map((ws) => ws.deserializeAttachment()),
      writers
    );
    for (const { index, attachment } of changes) {
      const ws = sockets[index];
      try {
        ws.serializeAttachment(attachment);
        ws.send(encodeFrame({ type: 'access', write: attachment.write }));
      } catch {
        // The socket closed after the list was taken.
      }
    }
  }

  /** RPC for unit 3's takedown (R43): clear the log, mark it gone, close every socket with 4410. */
  async takeDown(): Promise<void> {
    const host = this.#host;
    if (!host) throw new Error('sim object unavailable');
    await host.takeDown(Date.now());
    for (const ws of this.ctx.getWebSockets()) this.#close(ws, CLOSE_GONE, 'gone');
  }

  #label(): string {
    return this.ctx.id.name ?? '-';
  }

  #d1(): Database {
    return d1Drizzle(this.env.DB, { schema: d1Schema }) as Database;
  }

  #send(ws: WebSocket, frame: string): void {
    try {
      ws.send(frame);
    } catch {
      // The socket closed; its close handler runs separately.
    }
  }

  #close(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  /** Stores resumed: true on the socket's current attachment (re-read, so a concurrent
   *  rereadRoles is not overwritten). */
  #markResumed(ws: WebSocket): void {
    try {
      const a = parseAttachment(ws.deserializeAttachment());
      if (a) ws.serializeAttachment({ ...a, resumed: true });
    } catch {
      // The socket closed.
    }
  }

  /** The host's onCommit: never throws, so one dead socket neither stops the others nor makes a
   *  stored commit look failed to its author. */
  #broadcast(frame: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        if (parseAttachment(ws.deserializeAttachment())?.resumed) ws.send(frame);
      } catch {
        // The socket closed between the list and the send.
      }
    }
  }

  async #kickIndex(): Promise<void> {
    const host = this.#host;
    const simId = this.ctx.id.name;
    if (this.#indexing || !host || !simId) return;
    this.#indexing = true;
    try {
      // Rows stored during an await are picked up by the next unindexed(); the last check and
      // the reset of #indexing run with no await between them, so no kick is lost.
      for (
        let batch = host.unindexed(INDEX_BATCH);
        batch.length > 0;
        batch = host.unindexed(INDEX_BATCH)
      ) {
        await syncSimIndex(this.#d1(), simId, batch, host.summary());
        host.markIndexed(batch[batch.length - 1].commit.seq);
      }
    } catch (e) {
      console.error('[sim-object] index write failed', simId, loggable(e));
      try {
        if ((await this.ctx.storage.getAlarm()) === null) {
          await this.ctx.storage.setAlarm(Date.now() + INDEX_RETRY_MS);
        }
      } catch (e2) {
        console.error('[sim-object] index retry not scheduled', simId, loggable(e2));
      }
    } finally {
      this.#indexing = false;
    }
  }
}
