// Restore and open for the schema 4 /sim page: the autosave's outcome and the reconcile report as
// today's notices, the "upgraded" notice, the moved-dates notice (OQ-4) and the Remix toast.
import { describe, expect, it } from 'vitest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { formatMonthYear } from '$lib/fzp/format';
import { Autosave } from '$lib/sharing/autosave.svelte';
import { copyFor } from '$lib/sharing/copy';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { DEFAULT_POLICY, SIM_CODEC, SIM_KEY, type SimDoc } from '$lib/sim-page/sim-doc';
import { TIMING_NOTICE_TEXT } from '$lib/sim-page/sim-session';
import { resolvePreset } from '$lib/sim-page/timing';
import { fundingOnly } from '$lib/sim/levers/fixtures/finance';
import { monthFirstDay } from '$lib/sim/world/months';
import type { Programme } from '$lib/timelapse/types';
import { DATES_MOVED_NOTICE } from './copy';
import type { Policy, SimPolicy4 } from './policy4';
import { openShared, restoreSim4, UPGRADED_TEXT } from './session4';
import {
  SIM_KEY4,
  createSimCodec4,
  serializeSimDoc4,
  type OpenDataset,
  type SimDoc4
} from './sim-doc4';

const cal = fixtureCalibration();
const asOf = cal.asOf;
const ds: OpenDataset = { asOf, calibration: cal };
const SIM = copyFor('sim');

const F = fundingOnly();
const guarantee: Programme = {
  ...F.programmes[0],
  id: 'u-g',
  label: 'Loan guarantee',
  instrument: { kind: 'guarantee', costShare: 0.5, reserve: 0.1 }
};
const M2 = monthFirstDay(asOf, 2);

const fund: Policy = {
  id: 'fund',
  label: 'Added pool',
  preset: null,
  on: true,
  where: { tag: 'fund', pool: 'u-pool-1' },
  spans: [{ from: M2, to: null, what: { tag: 'fund', pool: F.pools[0], programmes: [guarantee] } }]
};
const sd = resolvePreset('benchmarkPermits', cal);
const tampered: Policy = {
  id: 'timing',
  label: "Permits at San Diego's pace",
  preset: sd.preset,
  on: true,
  where: { tag: 'routes' },
  spans: [
    {
      from: M2,
      to: null,
      what: {
        tag: 'timing',
        set: { ...sd, presetTimers: sd.presetTimers.map((t) => ({ ...t, scale: 0.3 })) }
      }
    }
  ]
};
/** A protection saved on another dataset: its span starts mid-month. */
const protect: Policy = {
  id: 'protect',
  label: 'Protect rent-controlled buildings',
  preset: null,
  on: true,
  where: { tag: 'category', category: 'rentControl' },
  spans: [{ from: M2 + 3, to: null, what: { tag: 'protect', years: null } }]
};

const doc4 = (policy: SimPolicy4, datasetVersion = 'fixture-0'): SimDoc4 => ({
  schema: 4,
  kind: 'sim',
  datasetVersion,
  policy
});
const record = (plan: string) => JSON.stringify({ v: 1, savedAt: 'x', plan });
const autosaveOf = (mem: MemoryStorage) =>
  new Autosave<SimDoc4>({
    currentVersion: 'fixture-0',
    codec: createSimCodec4(ds),
    storage: () => mem
  });

describe('restoreSim4', () => {
  it('notices in order: autosave, funding, timing, moved dates, upgraded, remix', () => {
    const mem = new MemoryStorage();
    const policy: SimPolicy4 = {
      schema: 4,
      kinds: { zoning: [protect], permitting: [tampered], money: [fund] }
    };
    mem.setItem(SIM_KEY4, record(serializeSimDoc4(doc4(policy, 'fixture-9'))));
    const { doc, notices } = restoreSim4(mem, autosaveOf(mem), ds, {
      from: 'SD permits',
      upgradedFrom: 3
    });
    expect(notices.map((n) => n.id)).toEqual([
      'rebased',
      'funding-dropped',
      'timing',
      'dates-moved',
      'upgraded',
      'remix'
    ]);
    expect(notices.find((n) => n.id === 'timing')?.text).toBe(TIMING_NOTICE_TEXT);
    const moved = notices.find((n) => n.id === 'dates-moved')!;
    expect(moved.text).toBe(DATES_MOVED_NOTICE);
    expect(moved.tone).toBe('info');
    // The per-change lines are behind the Details disclosure, never the notice text.
    expect(moved.details).toEqual([
      `Protect rent-controlled buildings: ${formatMonthYear(M2)} – no end`
    ]);
    expect(notices.find((n) => n.id === 'upgraded')?.text).toBe(
      UPGRADED_TEXT(formatMonthYear(monthFirstDay(asOf, 1)))
    );
    expect(notices.at(-1)).toMatchObject({ text: SIM.remixedToast('SD permits'), tone: 'toast' });
    // The document is the reconciled one: the guarantee is gone.
    const f = doc.policy.kinds.money[0].spans[0].what;
    expect(f.tag === 'fund' && f.programmes).toEqual([]);
    expect(doc.datasetVersion).toBe('fixture-0');
  });

  it('migrates a v1 schema 3 record first, and says it was upgraded', () => {
    const mem = new MemoryStorage();
    const old: SimDoc = {
      schema: 3,
      kind: 'sim',
      datasetVersion: 'fixture-0',
      policy: { ...DEFAULT_POLICY, protect: { ...DEFAULT_POLICY.protect, historic: true } }
    };
    mem.setItem(SIM_KEY, record(SIM_CODEC.serialize(old)));
    const { doc, notices } = restoreSim4(mem, autosaveOf(mem), ds);
    expect(mem.getItem(SIM_KEY4)).not.toBeNull();
    expect(doc.schema).toBe(4);
    expect(doc.policy.kinds.zoning.map((p) => p.where)).toEqual([
      { tag: 'category', category: 'historic' }
    ]);
    expect(notices.map((n) => n.id)).toEqual(['upgraded']);
  });

  it('a clean v2 record opens with no notice', () => {
    const mem = new MemoryStorage();
    const policy: SimPolicy4 = {
      schema: 4,
      kinds: {
        zoning: [{ ...protect, spans: [{ ...protect.spans[0], from: M2 }] }],
        permitting: [],
        money: []
      }
    };
    mem.setItem(SIM_KEY4, record(serializeSimDoc4(doc4(policy))));
    const { doc, notices } = restoreSim4(mem, autosaveOf(mem), ds);
    expect(notices).toEqual([]);
    expect(doc.policy).toEqual(policy);
  });

  it('a Remix document rides along when storage failed, with its report', () => {
    const mem = new MemoryStorage();
    const policy: SimPolicy4 = {
      schema: 4,
      kinds: { zoning: [protect], permitting: [], money: [] }
    };
    const { doc, notices } = restoreSim4(mem, autosaveOf(mem), ds, {
      from: 'Shared',
      doc: serializeSimDoc4(doc4(policy))
    });
    expect(doc.policy.kinds.zoning[0].spans[0].from).toBe(M2);
    expect(notices.map((n) => n.id)).toEqual(['dates-moved', 'remix']);
  });

  it('a v1 record the migration could not write still opens, from its text', () => {
    const mem = new MemoryStorage();
    const old: SimDoc = {
      schema: 3,
      kind: 'sim',
      datasetVersion: 'fixture-0',
      policy: { ...DEFAULT_POLICY, protect: { ...DEFAULT_POLICY.protect, historic: true } }
    };
    mem.setItem(SIM_KEY, record(SIM_CODEC.serialize(old)));
    mem.failWrites = true;
    const a = autosaveOf(mem);
    const { doc, notices } = restoreSim4(mem, a, ds);
    expect(doc.policy.kinds.zoning.map((p) => p.where)).toEqual([
      { tag: 'category', category: 'historic' }
    ]);
    expect(notices.map((n) => n.id)).toEqual(['upgraded']);
    expect(a.status).toBe('off');
  });

  it('an unreadable v1 record opens the default with the corrupt notice, and is kept', () => {
    const mem = new MemoryStorage();
    mem.setItem(SIM_KEY, '{nope');
    const { doc, notices } = restoreSim4(mem, autosaveOf(mem), ds);
    expect(doc.policy.kinds).toEqual({ zoning: [], permitting: [], money: [] });
    expect(notices).toEqual([{ id: 'corrupt', text: SIM.n1, tone: 'info' }]);
    expect(mem.getItem(SIM_KEY)).toBe('{nope');
  });

  it('a corrupt v2 record beside a stale v1 shows the corrupt notice, not the v1', () => {
    const mem = new MemoryStorage();
    const old: SimDoc = {
      schema: 3,
      kind: 'sim',
      datasetVersion: 'fixture-0',
      policy: { ...DEFAULT_POLICY, protect: { ...DEFAULT_POLICY.protect, historic: true } }
    };
    mem.setItem(SIM_KEY, record(SIM_CODEC.serialize(old)));
    for (const bad of ['{nope', JSON.stringify({ v: 1, savedAt: 'x', plan: 7 })]) {
      mem.setItem(SIM_KEY4, bad);
      const { doc, notices } = restoreSim4(mem, autosaveOf(mem), ds);
      expect(doc.policy.kinds).toEqual({ zoning: [], permitting: [], money: [] });
      expect(notices).toEqual([{ id: 'corrupt', text: SIM.n1, tone: 'info' }]);
    }
  });

  it('with no storage, the default document and no notices', () => {
    const { doc, notices } = restoreSim4(null, autosaveOf(new MemoryStorage()), ds);
    expect(doc.policy.kinds).toEqual({ zoning: [], permitting: [], money: [] });
    expect(notices).toEqual([]);
  });
});

describe('openShared', () => {
  it('opens a schema 3 text upgraded, with its notices', () => {
    const old: SimDoc = {
      schema: 3,
      kind: 'sim',
      datasetVersion: 'fixture-0',
      policy: { ...DEFAULT_POLICY, protect: { ...DEFAULT_POLICY.protect, historic: true } }
    };
    const r = openShared(SIM_CODEC.serialize(old), ds);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.schema).toBe(4);
    expect(r.notices.map((n) => n.id)).toEqual(['upgraded']);
  });

  it('takes the upgrade from the caller when the text is already schema 4', () => {
    const policy: SimPolicy4 = {
      schema: 4,
      kinds: { zoning: [protect], permitting: [], money: [] }
    };
    const r = openShared(serializeSimDoc4(doc4(policy)), ds, 3);
    expect(r.ok && r.notices.map((n) => n.id)).toEqual(['dates-moved', 'upgraded']);
  });

  it('refuses a text it cannot open', () => {
    expect(openShared('{nope', ds)).toEqual({ ok: false });
  });
});
