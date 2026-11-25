import { describe, expect, it } from 'vitest';
import { buy, treeView } from './tree';

describe('tree', () => {
  it('treeView throws until tree-catalogue writes it', () => {
    expect(() => treeView({} as never)).toThrow('not implemented');
  });

  it('buy throws until tree-catalogue writes it', () => {
    expect(() => buy({} as never, 'x')).toThrow('not implemented');
  });
});
