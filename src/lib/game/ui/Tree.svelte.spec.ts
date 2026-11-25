/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import '../../../routes/layout.css';
import type { NodeView, TreeNode } from '../tree';
import { branchRows, type TreeRow } from './layout';
import { REVEAL_MS } from './motion';
import type Tree from './Tree.svelte';
import TreeHost from './test/TreeHost.svelte';
import { nodeLevel, nodeView, treeNode } from './test/fixtures';
import {
  BOUGHT,
  CURRENT_LAW,
  OFF,
  SOURCE,
  boughtLive,
  buyName,
  editName,
  nextPriceName,
  nextStepText,
  priceName,
  shortText,
  switchName
} from './words';

/** Both media features at once: each Emulation.setEmulatedMedia call replaces the last. */
async function emulate(scheme: 'light' | 'dark', motion: 'reduce' | 'no-preference' = 'reduce') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: scheme },
      { name: 'prefers-reduced-motion', value: motion }
    ]
  });
}

afterEach(async () => {
  await emulate('light', 'reduce');
});

type Props = ComponentProps<typeof Tree>;

function props(over: Partial<Props> = {}): Props {
  return {
    nodes: [],
    on: {},
    units: { home: 500 },
    busy: false,
    next: null,
    ending: null,
    onbuy: vi.fn(),
    onedit: vi.fn(),
    ontoggle: vi.fn(),
    onrun: vi.fn(),
    onnext: vi.fn(),
    onpublish: vi.fn(),
    ...over
  };
}

function mount(over: Partial<Props> = {}, onescape?: () => void) {
  return render(TreeHost, { props: { tree: props(over), onescape } });
}

const one = (id: string, label: string, over: Partial<TreeNode> = {}): TreeNode =>
  treeNode({ id, label, levels: [nodeLevel(300, 'Step 1')], ...over });
const two = (id: string, label: string, over: Partial<TreeNode> = {}): TreeNode =>
  treeNode({ id, label, levels: [nodeLevel(300, 'Step 1'), nodeLevel(420, 'Step 2')], ...over });

const li = (id: string) =>
  document.querySelector<HTMLLIElement>(`[data-testid="tree-node"][data-node="${id}"]`);
const card = (id: string) => li(id)?.firstElementChild as HTMLElement;
const openOf = (id: string) => page.getByRole('button', { name: `Node ${id}`, exact: true });
const opener = (label: string) => page.getByRole('button', { name: label, exact: true });
/** The card's second line as drawn (the aria-hidden copy inside the open button). */
const sub = (id: string) =>
  card(id)
    .querySelector('[data-testid="tree-node-open"] [aria-hidden="true"]')
    ?.textContent?.trim();
/**
 * The durations of a node's running animations. Svelte starts a transition with a zero-length
 * placeholder animation, then the fade itself.
 */
const durations = (id: string) =>
  (li(id)?.getAnimations() ?? []).map((a) => a.effect?.getTiming().duration);
const detail = () => page.getByTestId('tree-detail');
const buyButton = () => page.getByTestId('tree-buy');

describe('Tree', () => {
  it('branches and nesting as branchRows gives them; Current law first', async () => {
    const nodes: NodeView[] = [
      nodeView(treeNode({ id: 'h1', branch: 'hands' })),
      nodeView(treeNode({ id: 'p1', branch: 'permitting' })),
      nodeView(treeNode({ id: 'z1', branch: 'zoning', after: ['p1'] })),
      nodeView(treeNode({ id: 'p2', branch: 'permitting', after: ['p1'] })),
      nodeView(treeNode({ id: 'p3', branch: 'permitting', after: ['p2'] })),
      nodeView(treeNode({ id: 'p4', branch: 'permitting' }))
    ];
    await mount({ nodes });
    const root = page.getByTestId('tree-root');
    await expect.element(root).toHaveTextContent(CURRENT_LAW);
    const branches = page.getByTestId('tree-branch').elements();
    const expected = branchRows(nodes);
    expect(branches.map((b) => b.getAttribute('data-branch'))).toEqual(
      expected.map((b) => b.branch)
    );
    for (const b of branches) {
      expect(root.element().compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      );
    }
    const want = new Map<string, { branch: string; parent: string | null }>();
    const walk = (branch: string, rows: TreeRow[], parent: string | null) =>
      rows.forEach((r) => {
        want.set(r.view.node.id, { branch, parent });
        walk(branch, r.children, r.view.node.id);
      });
    expected.forEach((b) => walk(b.branch, b.rows, null));
    const items = page.getByTestId('tree-node').elements();
    expect(items).toHaveLength(nodes.length);
    for (const item of items) {
      const id = item.getAttribute('data-node') as string;
      const parent = item.parentElement?.closest('[data-testid="tree-node"]');
      expect({
        branch: item.closest('[data-testid="tree-branch"]')?.getAttribute('data-branch'),
        parent: parent?.getAttribute('data-node') ?? null
      }).toEqual(want.get(id));
    }
    // Siblings keep the order branchRows gives.
    const p1 = li('p1') as HTMLLIElement;
    const p1Kids = [...p1.querySelectorAll(':scope > ul > [data-testid="tree-node"]')];
    expect(p1Kids.map((e) => e.getAttribute('data-node'))).toEqual(['p2']);
  });

  it('a card by state', async () => {
    await mount({
      nodes: [
        nodeView(one('r', 'Ready')),
        nodeView(one('s', 'Short'), { state: 'short', short: { home: 298 } }),
        nodeView(one('d', 'Done'), { level: 1, state: 'done' }),
        nodeView(one('o', 'Off'), { level: 1, state: 'done' }),
        nodeView(two('l', 'Left'), { level: 1, state: 'ready' })
      ],
      on: { o: false }
    });
    await expect.element(page.getByTestId('tree')).toBeVisible();
    const cases: [string, string, string, string, string][] = [
      ['r', 'ready', 'border-accent', '◆ 300', priceName(300)],
      [
        's',
        'short',
        'text-ink-muted',
        '◆ 300 · 298 short',
        `${priceName(300)} · ${shortText(298)}`
      ],
      ['d', 'done', 'border-ink', 'Step 1', 'Step 1'],
      ['o', 'done', 'border-dashed', `Step 1 · ${OFF}`, `Step 1 · ${OFF}`],
      ['l', 'ready', 'border-ink', 'Step 1 · next ◆ 420', `Step 1 · ${nextPriceName(420)}`]
    ];
    const labels: Record<string, string> = {
      r: 'Ready',
      s: 'Short',
      d: 'Done',
      o: 'Off',
      l: 'Left'
    };
    for (const [id, state, look, text, description] of cases) {
      expect(li(id)?.getAttribute('data-state')).toBe(state);
      expect(card(id).className.split(/\s+/)).toContain(look);
      expect(sub(id)).toBe(text);
      await expect.element(opener(labels[id])).toHaveAccessibleName(labels[id]);
      await expect.element(opener(labels[id])).toHaveAccessibleDescription(description);
    }
    expect(card('d').className).not.toContain('border-dashed');
    expect(card('s').className).not.toContain('border-accent');
  });

  it('opening a node shows its detail', async () => {
    await mount({
      nodes: [
        nodeView(
          two('b', 'Beta', {
            line: 'Cuts the wait.',
            source: { text: 'Planning Code', href: 'https://example.org/code' }
          })
        ),
        nodeView(one('c', 'Gamma', { source: { text: 'Staff memo', href: null } })),
        nodeView(one('a', 'Alpha', { line: 'Plain.' }))
      ]
    });
    await opener('Beta').click();
    await expect.element(detail()).toBeVisible();
    await expect.element(detail()).toHaveTextContent('Cuts the wait.');
    await expect.element(detail()).toHaveTextContent(nextStepText('Step 1'));
    const link = page.getByTestId('tree-source');
    await expect.element(link).toHaveAttribute('href', 'https://example.org/code');
    await expect.element(link).toHaveAttribute('target', '_blank');
    await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect.element(link).toHaveTextContent('Planning Code');
    await expect.element(buyButton()).toBeVisible();
    expect(document.activeElement).toBe(opener('Beta').element());

    await opener('Gamma').click();
    await expect.element(detail()).toHaveTextContent(`${SOURCE}: Staff memo`);
    await expect.element(page.getByTestId('tree-source')).not.toBeInTheDocument();
    // Gamma has one level, 'Step 1': its next step would read nextStepText('Step 1').
    expect(detail().element().textContent).not.toContain(nextStepText('Step 1'));

    await opener('Alpha').click();
    await expect.element(detail()).toHaveTextContent('Plain.');
    expect(detail().element().textContent).not.toContain(SOURCE);
    await expect.element(page.getByTestId('tree-source')).not.toBeInTheDocument();
    await expect.element(buyButton()).toBeVisible();
  });

  it('one node open at a time; a second press closes it', async () => {
    await mount({ nodes: [nodeView(one('a', 'Alpha')), nodeView(one('b', 'Beta'))] });
    await opener('Alpha').click();
    await expect.element(opener('Alpha')).toHaveAttribute('aria-expanded', 'true');
    await opener('Beta').click();
    await expect.element(opener('Beta')).toHaveAttribute('aria-expanded', 'true');
    await expect.element(opener('Alpha')).toHaveAttribute('aria-expanded', 'false');
    expect(detail().elements()).toHaveLength(1);
    await expect.element(detail().getByRole('heading', { name: 'Beta' })).toBeVisible();
    await opener('Beta').click();
    await expect.element(opener('Beta')).toHaveAttribute('aria-expanded', 'false');
    await expect.element(detail()).not.toBeInTheDocument();
  });

  it('Escape closes the detail and focuses its button', async () => {
    const onescape = vi.fn();
    const seen: boolean[] = [];
    const record = (e: KeyboardEvent) => {
      if (e.key === 'Escape') seen.push(e.defaultPrevented);
    };
    window.addEventListener('keydown', record);
    try {
      await mount({ nodes: [nodeView(one('a', 'Alpha'))] }, onescape);
      await opener('Alpha').click();
      await expect.element(detail()).toBeVisible();
      await userEvent.keyboard('{Escape}');
      await expect.element(detail()).not.toBeInTheDocument();
      await expect.element(opener('Alpha')).toHaveFocus();
      // Handled, not stopped: it still reaches the window, marked as handled.
      expect(onescape).toHaveBeenCalledTimes(1);
      expect(seen).toEqual([true]);
    } finally {
      window.removeEventListener('keydown', record);
    }
  });

  it('Escape with nothing open reaches the window', async () => {
    const onescape = vi.fn();
    const seen: boolean[] = [];
    const record = (e: KeyboardEvent) => {
      if (e.key === 'Escape') seen.push(e.defaultPrevented);
    };
    window.addEventListener('keydown', record);
    try {
      await mount({ nodes: [nodeView(one('a', 'Alpha'))] }, onescape);
      await expect.element(opener('Alpha')).toBeVisible();
      opener('Alpha').element().focus();
      await userEvent.keyboard('{Escape}');
      expect(onescape).toHaveBeenCalledTimes(1);
      expect(seen).toEqual([false]);
    } finally {
      window.removeEventListener('keydown', record);
    }
  });

  it('Buy', async () => {
    const onbuy = vi.fn();
    await mount({
      onbuy,
      nodes: [
        nodeView(one('r', 'Ready')),
        nodeView(one('s', 'Short'), { state: 'short', short: { home: 298 } }),
        nodeView(one('d', 'Done'), { level: 1, state: 'done' })
      ]
    });
    await opener('Ready').click();
    await expect.element(buyButton()).toHaveAccessibleName(buyName(300));
    await buyButton().click();
    expect(onbuy).toHaveBeenCalledExactlyOnceWith('r');

    await opener('Short').click();
    await expect.element(buyButton()).toHaveAttribute('aria-disabled', 'true');
    await expect.element(buyButton()).toHaveAccessibleName(buyName(300));
    await expect.element(buyButton()).toHaveAccessibleDescription(shortText(298));
    // Playwright treats aria-disabled as not enabled; press it anyway.
    await buyButton().click({ force: true });
    expect(onbuy).toHaveBeenCalledTimes(1);

    await opener('Done').click();
    await expect.element(detail()).toHaveTextContent(BOUGHT);
    await expect.element(buyButton()).not.toBeInTheDocument();
  });

  it('after a purchase the live region speaks and focus follows', async () => {
    const live = page.getByTestId('tree-live');
    const a = one('a', 'Alpha');
    const b = two('b', 'Beta');
    const screen = await mount({ nodes: [nodeView(a), nodeView(b)] });

    // A press the store refused: nothing changes.
    await opener('Alpha').click();
    await buyButton().click();
    await expect.element(buyButton()).toBeVisible();
    expect(live.element().textContent?.trim()).toBe('');

    // Bought out: the live region speaks and focus moves to the detail's heading.
    await screen.rerender({
      tree: props({ nodes: [nodeView(a, { level: 1, state: 'done' }), nodeView(b)] })
    });
    await expect.element(live).toHaveTextContent(boughtLive('Alpha', 'Step 1'));
    await expect.element(detail().getByRole('heading', { name: 'Alpha' })).toHaveFocus();

    // A level left: focus stays on Buy.
    await opener('Beta').click();
    await buyButton().click();
    await screen.rerender({
      tree: props({
        nodes: [nodeView(a, { level: 1, state: 'done' }), nodeView(b, { level: 1 })]
      })
    });
    await expect.element(live).toHaveTextContent(boughtLive('Beta', 'Step 1'));
    await expect.element(buyButton()).toHaveFocus();
    await expect.element(buyButton()).toHaveAccessibleName(buyName(420));
  });

  it('Edit and the switch', async () => {
    const onedit = vi.fn();
    const ontoggle = vi.fn();
    const d = one('d', 'Done');
    const nodes = [nodeView(d, { level: 1, state: 'done' })];
    const screen = await mount({ nodes, on: { d: true }, onedit, ontoggle });
    const edit = page.getByTestId('tree-node-edit');
    await expect.element(edit).toHaveAccessibleName(editName('Done'));
    await edit.click();
    expect(onedit).toHaveBeenCalledExactlyOnceWith('d');

    const sw = page.getByRole('switch', { name: switchName('Done'), exact: true });
    await expect.element(sw).toHaveAttribute('aria-checked', 'true');
    await expect.element(sw).toHaveAttribute('data-testid', 'tree-node-on');
    await sw.click();
    expect(ontoggle).toHaveBeenCalledExactlyOnceWith('d', false);
    // The look follows the prop, never the press.
    expect(card('d').className).not.toContain('border-dashed');
    expect(sub('d')).toBe('Step 1');

    await screen.rerender({ tree: props({ nodes, on: { d: false }, onedit, ontoggle }) });
    await expect.element(sw).toHaveAttribute('aria-checked', 'false');
    expect(card('d').className).toContain('border-dashed');
    expect(sub('d')).toBe(`Step 1 · ${OFF}`);
    await sw.click();
    expect(ontoggle).toHaveBeenLastCalledWith('d', true);

    await screen.rerender({ tree: props({ nodes, on: {}, onedit, ontoggle }) });
    await expect.element(page.getByTestId('tree-node-on')).not.toBeInTheDocument();
    await expect.element(edit).toBeVisible();
  });

  it('no switch for a node not bought', async () => {
    await mount({ nodes: [nodeView(one('a', 'Alpha'))], on: { a: true } });
    await expect.element(opener('Alpha')).toBeVisible();
    await expect.element(page.getByTestId('tree-node-on')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('tree-node-edit')).not.toBeInTheDocument();
  });

  it('a node added after mount fades in', async () => {
    await emulate('light', 'no-preference');
    const a = nodeView(treeNode({ id: 'a' }));
    const b = nodeView(treeNode({ id: 'b' }));
    const screen = await mount({ nodes: [a] });
    await expect.element(openOf('a')).toBeVisible();
    expect(li('a')?.getAnimations()).toEqual([]);
    await screen.rerender({ tree: props({ nodes: [a, b] }) });
    await expect.poll(() => durations('b')).toContain(REVEAL_MS);
    expect(li('a')?.getAnimations()).toEqual([]);
  });

  it('a first child under a node present at mount fades in', async () => {
    await emulate('light', 'no-preference');
    const a = nodeView(treeNode({ id: 'a' }), { level: 1, state: 'done' });
    const c = nodeView(treeNode({ id: 'c', after: ['a'] }));
    const screen = await mount({ nodes: [a] });
    await expect.element(openOf('a')).toBeVisible();
    await screen.rerender({ tree: props({ nodes: [a, c] }) });
    await expect.poll(() => durations('c')).toContain(REVEAL_MS);
    expect(li('c')?.parentElement?.closest('[data-testid="tree-node"]')).toBe(li('a'));
    expect(li('a')?.getAnimations()).toEqual([]);
  });

  it('a node in a branch not shown before fades in', async () => {
    await emulate('light', 'no-preference');
    const a = nodeView(treeNode({ id: 'a' }));
    const z = nodeView(treeNode({ id: 'z', branch: 'zoning' }));
    const screen = await mount({ nodes: [a] });
    await expect.element(openOf('a')).toBeVisible();
    await screen.rerender({ tree: props({ nodes: [a, z] }) });
    await expect.poll(() => durations('z')).toContain(REVEAL_MS);
    expect(li('a')?.getAnimations()).toEqual([]);
  });

  it('nodes present at mount have no fade', async () => {
    await emulate('light', 'no-preference');
    await mount({
      nodes: [
        nodeView(treeNode({ id: 'a' }), { level: 1, state: 'done' }),
        nodeView(treeNode({ id: 'c', after: ['a'] })),
        nodeView(treeNode({ id: 'z', branch: 'zoning' }))
      ]
    });
    await expect.element(openOf('z')).toBeVisible();
    for (const id of ['a', 'c', 'z']) expect(durations(id)).not.toContain(REVEAL_MS);
  });

  it('with reduced motion a node added after mount shows at once', async () => {
    const a = nodeView(treeNode({ id: 'a' }));
    const b = nodeView(treeNode({ id: 'b' }));
    const screen = await mount({ nodes: [a] });
    await expect.element(openOf('a')).toBeVisible();
    await screen.rerender({ tree: props({ nodes: [a, b] }) });
    await expect.element(openOf('b')).toBeInTheDocument();
    expect(getComputedStyle(li('b') as HTMLLIElement).opacity).toBe('1');
    expect(durations('b')).not.toContain(REVEAL_MS);
  });

  it('every control is at least 24 px', async () => {
    await mount({
      nodes: [
        nodeView(two('b', 'Beta', { source: { text: 'Code', href: 'https://example.org/c' } }), {
          level: 1
        })
      ],
      on: { b: true }
    });
    await opener('Beta').click();
    await expect.element(detail()).toBeVisible();
    const controls = [
      opener('Beta').element(),
      page.getByTestId('tree-node-edit').element(),
      page.getByTestId('tree-node-on').element(),
      buyButton().element(),
      page.getByTestId('tree-source').element()
    ];
    for (const c of controls) {
      const r = c.getBoundingClientRect();
      expect(r.width).toBeGreaterThanOrEqual(24);
      expect(r.height).toBeGreaterThanOrEqual(24);
    }
  });

  it('axe finds no violation in light and dark with a node open', async () => {
    await mount({
      nodes: [
        nodeView(two('b', 'Beta', { source: { text: 'Code', href: 'https://example.org/c' } }), {
          level: 1
        }),
        nodeView(one('s', 'Short', { after: ['b'] }), { state: 'short', short: { home: 298 } }),
        nodeView(one('o', 'Off', { branch: 'zoning' }), { level: 1, state: 'done' }),
        nodeView(one('m', 'Memo', { branch: 'money', source: { text: 'Memo', href: null } }))
      ],
      on: { b: true, o: false }
    });
    await opener('Short').click();
    await expect.element(detail()).toBeVisible();
    for (const s of ['light', 'dark'] as const) {
      await emulate(s);
      expect((await axe.run(page.getByTestId('tree').element())).violations).toEqual([]);
    }
  });
});
