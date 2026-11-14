import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isPasswordBreached } from './password-breach';

/** Mirrors the module's own RANGE_TIMEOUT_MS — kept in sync deliberately, not imported,
 *  since the module doesn't export it. */
const RANGE_TIMEOUT_MS = 2000;

// SHA-1('password') = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const KNOWN_PASSWORD = 'password';
const KNOWN_PREFIX = '5BAA6';
const KNOWN_SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

const OTHER_SUFFIX = '0000000000000000000000000000000000A';

function rangeResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, { status: 200, ...init });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => rangeResponse(''));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function requestedUrl(): string {
  return String(fetchMock.mock.calls[0][0]);
}

describe('isPasswordBreached k-anonymity', () => {
  it('sends ONLY a 5-hex-char prefix — the password itself never leaves', async () => {
    // A distinctive secret, so a substring hit is a real leak rather than an
    // accident of the endpoint hostname.
    const secret = 'zarquon-flux-capacitor-77';
    await isPasswordBreached(secret);
    const url = requestedUrl();
    // The load-bearing guarantee of this module.
    expect(url).not.toContain(secret);
    expect(url).toMatch(/^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/);
    // Nothing password-derived rides along in a body or a header either.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(JSON.stringify(init.headers)).not.toContain(secret);
  });

  it('sends the first five digest chars and withholds the remaining suffix', async () => {
    await isPasswordBreached(KNOWN_PASSWORD);
    const url = requestedUrl();
    const sent = url.split('/range/')[1];
    expect(sent).toBe(KNOWN_PREFIX);
    expect(sent).toHaveLength(5);
    expect(url).not.toContain(KNOWN_SUFFIX);
  });

  it('never calls the range API at all for an empty password', async () => {
    await expect(isPasswordBreached('')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('isPasswordBreached matching', () => {
  it('returns true when the suffix appears with a non-zero count', async () => {
    fetchMock.mockResolvedValueOnce(
      rangeResponse(`${OTHER_SUFFIX}:3\r\n${KNOWN_SUFFIX}:12345\r\n`)
    );
    await expect(isPasswordBreached(KNOWN_PASSWORD)).resolves.toBe(true);
  });

  it('matches the suffix case-insensitively', async () => {
    fetchMock.mockResolvedValueOnce(rangeResponse(`${KNOWN_SUFFIX.toLowerCase()}:9\r\n`));
    await expect(isPasswordBreached(KNOWN_PASSWORD)).resolves.toBe(true);
  });

  it('returns false when no returned suffix matches', async () => {
    fetchMock.mockResolvedValueOnce(rangeResponse(`${OTHER_SUFFIX}:500\r\n`));
    await expect(isPasswordBreached(KNOWN_PASSWORD)).resolves.toBe(false);
  });

  it('ignores padding entries, which carry a count of zero', async () => {
    fetchMock.mockResolvedValueOnce(rangeResponse(`${KNOWN_SUFFIX}:0\r\n`));
    await expect(isPasswordBreached(KNOWN_PASSWORD)).resolves.toBe(false);
  });
});

describe('isPasswordBreached fail-open', () => {
  it('allows the password when the range API returns a non-ok status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 503 }));
    await expect(isPasswordBreached(KNOWN_PASSWORD)).resolves.toBe(false);
  });

  it('allows the password when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    await expect(isPasswordBreached(KNOWN_PASSWORD)).resolves.toBe(false);
  });

  it('arms a not-yet-fired abort signal, then aborts and fails open when the range API hangs past the timeout deadline', async () => {
    // A fetch that never settles on its own — it only rejects if its own signal
    // aborts. If the code under test ever swaps a live AbortSignal.timeout() for
    // an inert one, this promise hangs forever instead of resolving to false,
    // which is exactly the regression this test exists to catch.
    let capturedSignal: AbortSignal | undefined;
    let signalAbortedAtCallTime: boolean | undefined;
    fetchMock.mockImplementationOnce(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // Captured synchronously at call time, before any timer advances —
          // this is what proves the signal is armed but not pre-aborted.
          capturedSignal = init?.signal ?? undefined;
          signalAbortedAtCallTime = init?.signal?.aborted;
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('signal timed out', 'TimeoutError'));
          });
        })
    );
    vi.useFakeTimers();
    try {
      const pending = isPasswordBreached(KNOWN_PASSWORD);
      await vi.advanceTimersByTimeAsync(RANGE_TIMEOUT_MS + 1);
      await expect(pending).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(signalAbortedAtCallTime).toBe(false);
  });
});
