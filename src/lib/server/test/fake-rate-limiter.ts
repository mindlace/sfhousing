// Stand-in for the Workers rate-limit binding (PUBLISH_RL): records every key and allows the
// first `allow` calls in total, then denies.
export class FakeRateLimiter {
  calls: string[] = [];
  private readonly allow: number;

  constructor(opts: { allow: number }) {
    this.allow = opts.allow;
  }

  async limit(o: { key: string }): Promise<{ success: boolean }> {
    this.calls.push(o.key);
    return { success: this.calls.length <= this.allow };
  }
}
