/** In-memory `Storage` for tests. `failWrites` makes `setItem` throw QuotaExceededError. */
export class MemoryStorage implements Storage {
  map = new Map<string, string>();
  failWrites = false;

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('full', 'QuotaExceededError');
    this.map.set(key, String(value));
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}
