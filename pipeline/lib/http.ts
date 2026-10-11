export interface HttpResponse {
  status: number;
  headers: Headers;
  body: Uint8Array;
}

/** Minimal GET surface so fetchers can be tested with a fake (no network in unit tests). */
export interface Http {
  get(url: string): Promise<HttpResponse>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Real HTTP over global fetch: follows redirects, retries 429/5xx and network errors 3 times. */
export const nodeHttp: Http = {
  async get(url) {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
      try {
        const res = await fetch(url, { headers: { 'user-agent': 'sfhousing-pipeline' } });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`GET ${url}: HTTP ${res.status}`);
          continue;
        }
        return {
          status: res.status,
          headers: res.headers,
          body: new Uint8Array(await res.arrayBuffer())
        };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
};
