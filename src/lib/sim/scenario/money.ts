/**
 * Pool state, money events and the ledger (spec 4.7). A `Treasury` holds one run's pool counters,
 * receives inflows, schedules a project's later money events when it is awarded, and emits the
 * ledger. With `emit` null it keeps the same state and builds no event objects.
 */
import type { Day } from '$lib/timelapse/time';
import { projectDollars } from '../finance';
import type { Sink } from './engine';
import {
  available,
  inflowArrivals,
  isOff,
  newPoolState,
  type Award,
  type FinanceIndex,
  type PoolState
} from './funding';
import type { Schedule } from './types';

export type LedgerEvent = Parameters<NonNullable<Sink['ledger']>>[0];
type Kind = LedgerEvent['kind'];
type Instr = 'grant' | 'loan' | 'guarantee';

/** Within-day order of a project's later events (spec 4.7). */
const ORDER: Record<'spend' | 'repay' | 'loss' | 'release', number> = {
  spend: 0,
  repay: 1,
  loss: 2,
  release: 3
};

interface Scheduled {
  project: number;
  order: number;
  /** tie-break within one order and programme */
  sub: number;
  prog: number;
  pool: number;
  kind: 'spend' | 'repay' | 'loss' | 'release';
  instr: Instr;
  dollars: number;
}

export class Treasury {
  readonly state: PoolState[];
  private readonly arrivals = new Map<Day, { pool: number; dollars: number }[]>();
  private readonly due = new Map<Day, Scheduled[]>();
  private projects = 0;

  constructor(
    private readonly f: FinanceIndex,
    asOf: Day,
    private readonly horizon: Day,
    private readonly lossOnExit: number,
    private readonly emit: ((e: LedgerEvent) => void) | null,
    private readonly wake: (day: Day) => void
  ) {
    const fin = f.finance;
    this.state = fin.pools.map(() => newPoolState());
    fin.pools.forEach((p, q) => {
      if (!f.capped[q]) return;
      for (const fl of p.inflows) {
        const dollars = fl.kind === 'once' ? fl.dollars : fl.dollarsPerYear;
        for (const day of inflowArrivals(fl, asOf, horizon)) {
          if (isOff(f, q, day)) continue;
          const list = this.arrivals.get(day);
          if (list) list.push({ pool: q, dollars });
          else this.arrivals.set(day, [{ pool: q, dollars }]);
        }
      }
    });
    // Within a day: pools in `finance.pools` order, then arrival order (the sort is stable).
    for (const list of this.arrivals.values()) list.sort((a, b) => a.pool - b.pool);
    for (const day of this.arrivals.keys()) wake(day);
  }

  available(pool: number): number {
    return available(this.f.finance.pools[pool], this.state[pool]);
  }

  /** Step 1: the day's inflows. True when any dollars arrived. */
  receive(day: Day): boolean {
    const list = this.arrivals.get(day);
    if (!list) return false;
    this.arrivals.delete(day);
    let any = false;
    for (const a of list) {
      if (a.dollars === 0) continue;
      any = true;
      this.state[a.pool].received += a.dollars;
      this.out(day, a.pool, null, 'in', a.dollars);
    }
    return any;
  }

  /** Step 3: commit an award and schedule the project's later events. */
  award(day: Day, a: Award, units: number, s: Schedule): void {
    const project = this.projects++;
    const fin = this.f.finance;
    const exit = s.end.kind === 'exit';
    const construction = s.entered.construction;
    const endDay = s.end.kind === 'open' ? null : s.end.day;
    const afterConstruction = exit && construction !== undefined;
    const lambda = this.lossOnExit;
    a.set.forEach((prog, i) => {
      const it = a.priced.items[i];
      const pool = this.f.progPool[prog];
      const instr = fin.programmes[prog].instrument.kind;
      const G = projectDollars(it.granted, units);
      const P = projectDollars(it.lent, units);
      const H = projectDollars(it.reserve, units);
      const commit = instr === 'grant' ? G : instr === 'loan' ? P : H;
      const put = (
        at: Day | null | undefined,
        kind: Scheduled['kind'],
        dollars: number,
        order = ORDER[kind]
      ): void => {
        if (at == null || at > this.horizon || dollars === 0) return;
        const e: Scheduled = {
          project,
          order,
          sub: kind === 'loss' ? 1 : 0,
          prog,
          pool,
          kind,
          instr,
          dollars
        };
        const list = this.due.get(at);
        if (list) list.push(e);
        else this.due.set(at, [e]);
        this.wake(at);
      };
      if (commit > 0) {
        this.state[pool].committed += commit;
        this.out(day, pool, prog, 'commit', commit);
      }
      if (instr === 'grant') {
        if (construction !== undefined) put(construction, 'spend', G);
        if (afterConstruction) put(endDay, 'loss', Math.round(lambda * G));
        else if (exit) put(endDay, 'release', G);
      } else if (instr === 'loan') {
        if (construction !== undefined) put(construction, 'spend', P);
        if (s.end.kind === 'complete') put(endDay, 'repay', P);
        else if (afterConstruction) {
          const L = Math.round(lambda * P);
          put(endDay, 'repay', P - L);
          put(endDay, 'loss', L);
        } else if (exit) put(endDay, 'release', P);
      } else if (s.end.kind === 'complete') {
        put(endDay, 'release', H);
      } else if (exit) {
        if (afterConstruction) {
          const Q = projectDollars(it.guaranteed, units);
          put(endDay, 'loss', Math.min(Math.round(lambda * Q), H));
        }
        // A guarantee's release precedes its loss (conductor ruling, E4 after every event): it
        // sorts with the loss's order, ahead of it.
        put(endDay, 'release', H, afterConstruction ? ORDER.loss : undefined);
      }
    });
  }

  /** Step 2: events dated `day` of the projects awarded so far, in award order. */
  settle(day: Day): { any: boolean; returned: boolean } {
    const list = this.due.get(day);
    if (!list) return { any: false, returned: false };
    this.due.delete(day);
    list.sort(
      (x, y) => x.project - y.project || x.order - y.order || x.prog - y.prog || x.sub - y.sub
    );
    let returned = false;
    for (const e of list) {
      const st = this.state[e.pool];
      const d = e.dollars;
      switch (e.kind) {
        case 'spend':
          st.committed -= d;
          if (e.instr === 'grant') st.spentGrant += d;
          else st.outLoan += d;
          break;
        case 'repay':
          st.outLoan -= d;
          if (this.f.capped[e.pool]) returned = true;
          break;
        case 'loss':
          if (e.instr === 'loan') {
            st.outLoan -= d;
            st.lostLoan += d;
          } else if (e.instr === 'guarantee') st.lostGuarantee += d;
          break;
        case 'release':
          st.committed -= d;
          if (this.f.capped[e.pool]) returned = true;
          break;
      }
      this.out(day, e.pool, e.prog, e.kind, d);
    }
    return { any: true, returned };
  }

  private out(day: Day, pool: number, prog: number | null, kind: Kind, dollars: number): void {
    if (!this.emit) return;
    this.emit({
      day,
      pool: this.f.finance.pools[pool].id,
      programme: prog === null ? null : this.f.finance.programmes[prog].id,
      kind,
      dollars
    });
  }
}
