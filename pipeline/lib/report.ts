/** Collects counts, step timings and warnings for the build report. */
export class Report {
  counts: Record<string, number> = {};
  timings: Record<string, number> = {};
  warnings: string[] = [];

  set(k: string, v: number): void {
    this.counts[k] = v;
  }

  async time<T>(step: string, f: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await f();
    } finally {
      this.timings[step] = Math.round(performance.now() - t0);
    }
  }

  toJSON(): object {
    return { counts: this.counts, timings: this.timings, warnings: this.warnings };
  }
}
