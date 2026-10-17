/**
 * Union-find over string node keys. The root of a set is its lexicographically smallest key, so
 * the result does not depend on the order of unions.
 */
export class UnionFind {
  private readonly parent = new Map<string, string>();

  add(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }

  find(key: string): string {
    const parent = this.parent;
    if (!parent.has(key)) throw new Error(`union-find: unknown key ${key}`);
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let x = key;
    while (x !== root) {
      const next = parent.get(x)!;
      parent.set(x, root);
      x = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}
