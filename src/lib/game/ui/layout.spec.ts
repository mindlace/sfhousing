import { describe, expect, it } from 'vitest';
import { branchRows, type TreeRow } from './layout';
import { nodeView, treeNode } from './test/fixtures';
import type { Branch } from '../tree';

const view = (id: string, branch: Branch, after: string[] = []) =>
  nodeView(treeNode({ id, branch, after }));

const ids = (rows: TreeRow[]): string[] => rows.map((r) => r.view.node.id);

describe('branchRows', () => {
  it('branches come in BRANCH_ORDER', () => {
    const out = branchRows([view('h', 'hands'), view('z', 'zoning'), view('p', 'permitting')]);
    expect(out.map((b) => b.branch)).toEqual(['permitting', 'zoning', 'hands']);
  });

  it('a child nests under the first earlier node of its branch named in after', () => {
    const out = branchRows([
      view('a', 'permitting'),
      view('b', 'permitting'),
      view('c', 'permitting', ['x', 'b', 'a'])
    ]);
    expect(ids(out[0].rows)).toEqual(['a', 'b']);
    expect(ids(out[0].rows[1].children)).toEqual(['c']);
    expect(out[0].rows[0].children).toEqual([]);
  });

  it('an after in another branch makes a root', () => {
    const out = branchRows([view('a', 'permitting'), view('b', 'zoning', ['a'])]);
    expect(out.map((b) => ids(b.rows))).toEqual([['a'], ['b']]);
  });

  it('an after naming a later node makes a root', () => {
    const out = branchRows([view('a', 'permitting', ['b']), view('b', 'permitting')]);
    expect(ids(out[0].rows)).toEqual(['a', 'b']);
  });

  it('siblings keep catalogue order', () => {
    const out = branchRows([
      view('r1', 'zoning'),
      view('k2', 'zoning', ['r1']),
      view('r2', 'zoning'),
      view('k1', 'zoning', ['r1'])
    ]);
    expect(ids(out[0].rows)).toEqual(['r1', 'r2']);
    expect(ids(out[0].rows[0].children)).toEqual(['k2', 'k1']);
  });

  it('every node appears exactly once', () => {
    const input = [
      view('a', 'permitting'),
      view('b', 'permitting', ['a']),
      view('c', 'permitting', ['b']),
      view('d', 'hands', ['a']),
      view('e', 'zoning', ['z'])
    ];
    const seen: string[] = [];
    const walk = (rows: TreeRow[]) =>
      rows.forEach((r) => {
        seen.push(r.view.node.id);
        walk(r.children);
      });
    branchRows(input).forEach((b) => walk(b.rows));
    expect(seen.sort()).toEqual(input.map((v) => v.node.id).sort());
  });
});

describe('import boundary', () => {
  const files = import.meta.glob('./**/*.{ts,svelte}', {
    query: '?raw',
    import: 'default',
    eager: true
  }) as Record<string, string>;
  const sources = Object.entries(files).filter(([path]) => !path.endsWith('.spec.ts'));

  it('scans the folder', () => {
    expect(Object.keys(files)).toContain('./layout.ts');
  });

  it('no file imports the sim, map, timeline or sim-page code', () => {
    const bad = sources.flatMap(([path, text]) =>
      text
        .split('\n')
        .filter((line) => /from '\$lib\/(sim|map|timeline|sim-page)(\/|')/.test(line))
        .map((line) => `${path}: ${line}`)
    );
    expect(bad).toEqual([]);
  });
});
