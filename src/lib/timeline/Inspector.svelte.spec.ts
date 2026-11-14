/// <reference types="@vitest/browser-playwright" />
// The inspector (timeline-ui spec, rules 10 to 15 and 17): When and What on the selected span,
// the policy's switch, Remove and order, "+" through the add menu, the funding draft's discard,
// read-only view and focus going back to the bar.
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { formatMonthYear } from '$lib/fzp/format';
import { DRAFT_DISCARDED, limitAlert } from '$lib/sim-page/funding-copy';
import { FINANCE_LIMITS } from '$lib/sim/levers/finance';
import type { FundingDrafts } from '$lib/sim-page/funding-drafts.svelte';
import type { PolicyStore } from '$lib/sim-page/policy-store.svelte';
import { BOND_POLICY, fundingCalibration, policyWith } from '$lib/sim-page/test/funding';
import { OBSERVED_TIMING } from '$lib/sim-page/timing';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import { monthFirstDay, monthLastDay, monthOfDay } from '$lib/sim/world/months';
import { addPolicy } from './add';
import { TERMS_HINT } from './copy';
import { PRESET_PER_POLICY } from './lens';
import type { Policy, SimPolicy4 } from './policy4';
import { FIXED_LABEL } from './rows';
import { movePolicy, removePolicy, setOn, type SpanRef, type TimelineWindow } from './spans';
import { upgradePolicy } from './upgrade';
import InspectorHost from './test/InspectorHost.svelte';

const cal = fundingCalibration();
const asOf = cal.asOf;
const w: TimelineWindow = { asOf, months: WINDOW_MONTHS };
const first = (m: number) => monthFirstDay(asOf, m);
const last = (m: number) => monthLastDay(asOf, m);

const transit: Policy = {
  id: 'z1',
  label: 'Taller near transit',
  preset: null,
  on: true,
  where: { tag: 'transit', stopTypes: ['metro'] },
  spans: [{ from: first(1), to: null, what: { tag: 'bands', bands: [{ maxM: 400, stories: 8 }] } }]
};
const newer: Policy = {
  id: 'z2',
  label: 'Protect newer buildings',
  preset: null,
  on: true,
  where: { tag: 'category', category: 'newerThan' },
  spans: [
    { from: first(1), to: last(24), what: { tag: 'protect', years: 30 } },
    { from: first(25), to: null, what: { tag: 'protect', years: 40 } }
  ]
};
const timingSpan = (from: number, to: number | null, scale: number) => ({
  from: first(from),
  to: to === null ? null : last(to),
  what: {
    tag: 'timing' as const,
    set: {
      ...structuredClone(OBSERVED_TIMING.current),
      presetTimers: [
        {
          pathway: 'discretionary' as const,
          stage: 'permitFiled' as const,
          scale,
          reach: 'all' as const
        }
      ]
    }
  }
});
const permitting: Policy = {
  id: 'p1',
  label: 'Faster permit review',
  preset: 'observed',
  on: true,
  where: { tag: 'routes' },
  spans: [timingSpan(24, 71, 0.7), timingSpan(72, null, 0.5)]
};
const bond = upgradePolicy(BOND_POLICY, asOf).kinds.money;

const DOC: SimPolicy4 = {
  schema: 4,
  kinds: { zoning: [transit, newer], permitting: [permitting], money: bond }
};

function setup(
  opts: { doc?: SimPolicy4; initial?: SpanRef | null; readonly?: boolean; month?: number } = {}
) {
  let store!: PolicyStore<SimPolicy4>;
  let drafts!: FundingDrafts;
  const month = opts.month ?? 13;
  render(InspectorHost, {
    props: {
      doc: opts.doc ?? DOC,
      calibration: cal,
      playheadDay: first(month) + 3,
      readonly: opts.readonly ?? false,
      initial: opts.initial ?? null,
      onready: (h) => {
        store = h.store;
        drafts = h.drafts;
      }
    }
  });
  return { store, drafts, month };
}

const announced = () =>
  [...document.querySelectorAll('[data-testid="announced"] li')].map((li) => li.textContent);
const selectedText = () => document.querySelector('[data-testid="selected"]')!.textContent;
const bar = (r: string) => document.querySelector<HTMLElement>(`[data-ref="${r}"]`)!;
const editor = () => document.querySelector<HTMLElement>('[data-testid="inspector"]');

describe('Inspector', () => {
  it('adds a transit rule from the playhead month, selected', async () => {
    const { store, month } = setup({ month: 13 });
    await page.getByRole('button', { name: 'Add zoning' }).click();
    await page.getByRole('button', { name: 'Transit rule' }).click();
    const want = addPolicy(DOC, { kind: 'zoning', what: 'transit' }, { w, month, cal });
    // The new rule's id is random: the rest is addPolicy's document.
    const id = store.policy.kinds.zoning.at(-1)!.id;
    const zoning = want.doc.kinds.zoning.map((p) => (p.id === want.ref.id ? { ...p, id } : p));
    expect(store.policy).toEqual({ ...want.doc, kinds: { ...want.doc.kinds, zoning } });
    expect(store.undoLabel).toBe('Added: Transit rule');
    expect(announced()).toContain('Added: Transit rule');
    await expect.element(page.getByTestId('selected')).toHaveTextContent(`zoning/${id}/0`);
    const added = store.policy.kinds.zoning.at(-1)!;
    expect(added.spans[0].from).toBe(first(13));
    expect(added.spans[0].to).toBeNull();
    // The new policy's editor is open: its When reads from the playhead's month.
    await expect
      .element(page.getByRole('heading', { level: 2, name: added.label }))
      .toBeInTheDocument();
  });

  it('switches a policy off, removes it and reorders it; undo and redo across those', async () => {
    const { store } = setup({ initial: { kind: 'zoning', id: 'z2', span: 0 } });
    const d0 = store.policy;
    await page.getByRole('switch', { name: 'On' }).click();
    const d1 = setOn(d0, 'zoning', 'z2', false);
    expect(store.policy).toEqual(d1);
    await expect
      .element(page.getByRole('switch', { name: 'On' }))
      .toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: 'Move up' }).click();
    const d2 = movePolicy(d1, 'zoning', 'z2', -1);
    expect(store.policy).toEqual(d2);
    expect(store.policy.kinds.zoning.map((p) => p.id)).toEqual(['z2', 'z1']);
    // At the top it stays focusable, aria-disabled, with focus kept on it (WCAG 2.4.3).
    const up = page.getByRole('button', { name: 'Move up' });
    await expect.element(up).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(up.element());
    // A press there changes nothing (Playwright will not press an aria-disabled button).
    (up.element() as HTMLElement).click();
    expect(store.policy).toEqual(d2);
    await page.getByRole('button', { name: 'Remove policy' }).click();
    const d3 = removePolicy(d2, 'zoning', 'z2');
    expect(store.policy).toEqual(d3);
    expect(selectedText()).toBe('');
    for (let i = 0; i < 3; i++) store.undo();
    expect(store.policy).toBe(d0);
    for (let i = 0; i < 3; i++) store.redo();
    expect(store.policy).toEqual(d3);
  });

  it('edits the selected span only through the hosted editor', async () => {
    const { store } = setup({ initial: { kind: 'zoning', id: 'z2', span: 1 } });
    const before = store.policy.kinds.zoning[1];
    const years = page.getByRole('spinbutton', { name: 'Buildings newer than, in years' });
    await expect.element(years).toHaveValue(40);
    await years.fill('45');
    await userEvent.keyboard('{Tab}');
    const after = store.policy.kinds.zoning[1];
    expect(after.spans[1].what).toEqual({ tag: 'protect', years: 45 });
    expect(after.spans[0]).toBe(before.spans[0]);
    expect(store.policy.kinds.zoning[0]).toBe(DOC.kinds.zoning[0]);

    // A permitting preset is the policy's: on a policy of two spans it is not offered per span.
    await bar('permitting/p1/1').click();
    const preset = page.getByRole('combobox', { name: 'Preset' });
    await expect.element(preset).toBeDisabled();
    // The reason waits behind a tap (rule 37).
    expect(document.body.textContent).not.toContain(PRESET_PER_POLICY);
    await page.getByRole('button', { name: 'Preset fixed' }).click();
    await expect.element(page.getByText(PRESET_PER_POLICY)).toBeVisible();
  });

  it('an existing fund policy shows its debt terms read-only', async () => {
    const { store, drafts } = setup({ initial: { kind: 'money', id: bond[0].id, span: 0 } });
    // The pool's editor is open without a further tap.
    await expect.element(page.getByRole('textbox', { name: 'Name' })).toBeVisible();
    expect(editor()!.querySelector('input[data-field="rate"]')).toBeNull();
    expect(editor()!.querySelector('input[data-field="years"]')).toBeNull();
    expect(editor()!.querySelector('p[data-field="rate"]')!.textContent).toContain('6');
    // The hint waits behind a tap.
    expect(document.body.textContent).not.toContain(TERMS_HINT);
    await page.getByRole('button', { name: 'Terms fixed' }).click();
    await expect.element(page.getByText(TERMS_HINT)).toBeVisible();

    // Name and kind stay editable in place.
    const name = editor()!.querySelector<HTMLInputElement>('input[data-field="name"]')!;
    expect(name.disabled).toBe(false);
    await userEvent.fill(name, 'Renamed bond');
    await userEvent.keyboard('{Enter}');
    const span = store.policy.kinds.money[0].spans[0].what;
    expect(span.tag === 'fund' && span.pool?.label).toBe('Renamed bond');
    expect(span.tag === 'fund' && span.pool?.debt).toEqual({ rate: 0.06, termYears: 20 });
    const kind = page.getByRole('combobox', { name: 'Kind of money' });
    await expect.element(kind).toBeEnabled();
    const amount = editor()!.querySelector<HTMLInputElement>('input[data-field="amount-0"]')!;
    expect(amount.disabled).toBe(false);

    // A fund being added sets its terms.
    await page.getByRole('button', { name: 'Add money', exact: true }).click();
    await page.getByRole('button', { name: 'Your own pool' }).click();
    expect(drafts.isOpen).toBe(true);
    await userEvent.selectOptions(kind, 'goBond');
    const rate = editor()!.querySelector<HTMLInputElement>('input[data-field="rate"]')!;
    expect(rate.disabled).toBe(false);
    await userEvent.fill(rate, '4');
    await userEvent.keyboard('{Enter}');
    await userEvent.fill(
      editor()!.querySelector<HTMLInputElement>('input[data-field="amount-0"]')!,
      '100'
    );
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => store.policy.kinds.money.length).toBe(2);
    const added = store.policy.kinds.money[1];
    const what = added.spans[0].what;
    expect(what.tag === 'fund' && what.pool?.debt?.rate).toBe(0.04);
    expect(added.spans[0].from).toBe(first(13));
    expect(drafts.isOpen).toBe(false);
    expect(selectedText()).toBe(`money/${added.id}/0`);
  });

  it('the month fields set from and to, snapped', async () => {
    const { store } = setup({ initial: { kind: 'zoning', id: 'z1', span: 0 }, month: 40 });
    const from = (part: string) => page.getByRole('combobox', { name: `From ${part}` });
    const to = (part: string) => page.getByRole('combobox', { name: `To ${part}` });
    const parts = (d: number) => {
      const t = new Date(d * 86_400_000);
      return { y: String(t.getUTCFullYear()), m: String(t.getUTCMonth() + 1) };
    };
    const target = parts(first(30));
    await userEvent.selectOptions(from('year').element(), target.y);
    await userEvent.selectOptions(from('month').element(), target.m);
    const s = () => store.policy.kinds.zoning[0].spans[0];
    // Snapped: a model month's first day, labelled the month and year chosen.
    expect(monthFirstDay(asOf, monthOfDay(asOf, s().from))).toBe(s().from);
    expect(formatMonthYear(s().from)).toBe(formatMonthYear(first(30)));
    await expect.element(from('year')).toHaveValue(target.y);
    await expect.element(from('month')).toHaveValue(target.m);

    const end = parts(last(60));
    await userEvent.selectOptions(to('year').element(), end.y);
    await userEvent.selectOptions(to('month').element(), end.m);
    expect(s().to).not.toBeNull();
    expect(monthLastDay(asOf, monthOfDay(asOf, s().to!))).toBe(s().to);
    expect(formatMonthYear(s().to!)).toBe(formatMonthYear(last(60)));
    await userEvent.selectOptions(to('year').element(), '');
    expect(s().to).toBeNull();
    await expect.element(to('month')).toBeDisabled();

    // Split at the playhead month selects the later part; the only span cannot be removed.
    await expect
      .element(page.getByRole('button', { name: 'Remove span' }))
      .toHaveAttribute('aria-disabled', 'true');
    const start = s().from;
    await page.getByRole('button', { name: 'Split at playhead' }).click();
    expect(store.policy.kinds.zoning[0].spans.map((x) => [x.from, x.to])).toEqual([
      [start, last(39)],
      [first(40), null]
    ]);
    expect(selectedText()).toBe('zoning/z1/1');
    await page.getByRole('button', { name: 'Remove span' }).click();
    expect(store.policy.kinds.zoning[0].spans).toHaveLength(1);
    expect(selectedText()).toBe('zoning/z1/0');
    await page.getByRole('button', { name: 'Add span' }).click();
    expect(store.policy.kinds.zoning[0].spans.map((x) => [x.from, x.to])).toEqual([
      [start, last(39)],
      [first(40), null]
    ]);
    expect(selectedText()).toBe('zoning/z1/1');
  });

  it('discards an unfinished funding draft when another policy is selected, and says so', async () => {
    const { drafts } = setup();
    await page.getByRole('button', { name: 'Add money', exact: true }).click();
    await page.getByRole('button', { name: 'Your own pool' }).click();
    expect(drafts.isOpen).toBe(true);
    await bar('zoning/z1/0').click();
    await expect.poll(() => drafts.isOpen).toBe(false);
    expect(announced()).toContain(DRAFT_DISCARDED);
    await expect
      .element(page.getByRole('heading', { level: 2, name: 'Taller near transit' }))
      .toBeInTheDocument();
  });

  it('read-only renders no editable control', async () => {
    setup({ readonly: true, initial: { kind: 'zoning', id: 'z1', span: 0 } });
    await expect
      .element(page.getByRole('heading', { level: 2, name: 'Taller near transit' }))
      .toBeInTheDocument();
    const editable = () =>
      editor()!.querySelectorAll(
        'input:not([disabled]), select:not([disabled]), textarea, [contenteditable="true"]'
      );
    expect(editable()).toHaveLength(0);
    const names = () =>
      [...editor()!.querySelectorAll('button')].map(
        (b) => b.getAttribute('aria-label') ?? b.textContent?.trim()
      );
    expect(names()).toEqual(['Close editor']);
    expect(editor()!.textContent).toContain('no end');

    await bar('permitting/p1/0').click();
    await expect
      .element(page.getByRole('heading', { level: 2, name: 'Faster permit review' }))
      .toBeInTheDocument();
    expect(editable()).toHaveLength(0);
    // A disclosure that shows more of the summary is the only other button.
    expect(names().filter((n) => n !== 'Close editor')).toEqual([
      expect.stringContaining('Shares and changed stages')
    ]);

    // A fixed row shows what it is.
    await bar('zoning/fixed/-1').click();
    await expect
      .element(page.getByRole('heading', { level: 2, name: FIXED_LABEL.zoning }))
      .toBeInTheDocument();
    expect(editable()).toHaveLength(0);
    expect(names()).toEqual(['Close editor']);
    expect(editor()!.querySelectorAll('[role="switch"]')).toHaveLength(0);
    expect(editor()!.textContent).toContain('whole window');
  });

  it('focus returns to the bar when the editor closes', async () => {
    setup();
    await bar('zoning/z1/0').click();
    await page.getByRole('button', { name: 'Close editor' }).click();
    expect(document.activeElement).toBe(bar('zoning/z1/0'));
    expect(selectedText()).toBe('');

    // Escape inside the editor closes it too.
    await bar('permitting/p1/1').click();
    page.getByRole('button', { name: 'Close editor' }).element().focus();
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(bar('permitting/p1/1'));
    expect(selectedText()).toBe('');
  });

  it('a fund policy on a City pool shows its programmes and edits them', async () => {
    const prog = { ...BOND_POLICY.funding.programmes[0], id: 'u-prog-9', pool: 'city-gf' };
    const money = upgradePolicy(policyWith({ programmes: [prog] }), asOf).kinds.money;
    expect(money[0].spans[0].what).toMatchObject({ tag: 'fund', pool: null });
    const { store } = setup({
      doc: { schema: 4, kinds: { zoning: [], permitting: [], money } },
      initial: { kind: 'money', id: money[0].id, span: 0 }
    });
    const row = () => editor()!.querySelector<HTMLElement>('[data-prog-row="u-prog-9"]');
    await expect.poll(() => row()).not.toBeNull();
    row()!.querySelector('button')!.click();
    await expect
      .poll(() => row()!.querySelector('input[data-field="prog-minHomes"]'))
      .not.toBeNull();
    await userEvent.fill(
      row()!.querySelector<HTMLInputElement>('input[data-field="prog-minHomes"]')!,
      '33'
    );
    await userEvent.keyboard('{Enter}');
    const what = store.policy.kinds.money[0].spans[0].what;
    expect(what.tag === 'fund' && what.programmes[0].minHomes).toBe(33);
    expect(what.tag === 'fund' && what.pool).toBeNull();
  });

  it('a refused edit shows its reason', async () => {
    // 24 programmes in the document: one more, through the lens, passes the limit.
    const base = BOND_POLICY.funding.programmes[0];
    const progs = (pool: string, n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({ ...base, id: `u-prog-${from + i}`, pool }));
    const money = upgradePolicy(
      policyWith({ programmes: [...progs('city-tax', 23, 1), ...progs('city-gf', 1, 30)] }),
      asOf
    ).kinds.money;
    const gf = money.find((p) => p.where.tag === 'fund' && p.where.pool === 'city-gf')!;
    const { store } = setup({
      doc: { schema: 4, kinds: { zoning: [], permitting: [], money } },
      initial: { kind: 'money', id: gf.id, span: 0 }
    });
    const before = store.policy;
    await page.getByRole('button', { name: /^What it pays for: add a programme/ }).click();
    await expect.element(page.getByText(limitAlert('programmes'))).toBeVisible();
    expect(store.policy).toBe(before);
  });

  it('an add past the funding limits shows the limit, adds nothing', async () => {
    const pools = Array.from({ length: FINANCE_LIMITS.pools }, (_, i) => ({
      ...BOND_POLICY.funding.pools[0],
      id: `u-pool-${i + 1}`
    }));
    const money = upgradePolicy(policyWith({ pools, programmes: [] }), asOf).kinds.money;
    const { store } = setup({ doc: { schema: 4, kinds: { zoning: [], permitting: [], money } } });
    const before = store.policy;
    await page.getByRole('button', { name: 'Add money', exact: true }).click();
    await page.getByRole('button', { name: 'Your own pool' }).click();
    await expect.element(page.getByText(limitAlert('pools'))).toBeVisible();
    expect(store.policy).toBe(before);
  });

  it('discards a draft when the editor closes or "+" opens', async () => {
    const { drafts } = setup();
    await page.getByRole('button', { name: 'Add money', exact: true }).click();
    await page.getByRole('button', { name: 'Your own pool' }).click();
    expect(drafts.isOpen).toBe(true);
    await page.getByRole('button', { name: 'Close editor' }).click();
    expect(drafts.isOpen).toBe(false);
    expect(announced()).toEqual([DRAFT_DISCARDED]);

    await page.getByRole('button', { name: 'Add money', exact: true }).click();
    // Focus moves into the menu.
    await expect
      .poll(() => document.activeElement?.textContent)
      .toBe(document.querySelector('[data-testid="inspector"] ul button')!.textContent);
    await page.getByRole('button', { name: 'Your own pool' }).click();
    expect(drafts.isOpen).toBe(true);
    await page.getByRole('button', { name: 'Add zoning' }).click();
    await expect.poll(() => drafts.isOpen).toBe(false);
    expect(announced()).toEqual([DRAFT_DISCARDED, DRAFT_DISCARDED]);
  });

  it('read-only: a money policy shows no control; "+" offers nothing', async () => {
    setup({ readonly: true, initial: { kind: 'money', id: bond[0].id, span: 0 } });
    await expect
      .element(page.getByRole('heading', { level: 2, name: bond[0].label }))
      .toBeInTheDocument();
    const box = () => editor()!;
    expect(
      box().querySelectorAll(
        'input:not([disabled]), select:not([disabled]), textarea, [contenteditable="true"]'
      )
    ).toHaveLength(0);
    expect([...box().querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Close editor'
    ]);
    await page.getByRole('button', { name: 'Add zoning' }).click();
    expect(document.body.textContent).not.toContain('Transit rule');
  });
});
