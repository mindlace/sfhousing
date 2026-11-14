// Rate limiting over the Workers rate-limit bindings (PUBLISH_RL, the auth and invite limiters).
// development (e2e preview, local dev) always allows.
import { error } from '@sveltejs/kit';

export type RateLimiter = { limit(opts: { key: string }): Promise<{ success: boolean }> };

export type EnforceRateOptions = {
  /**
   * An abuse-facing front-door limiter. A missing binding in production then fails closed
   * (deny, console.error with label only) instead of allowing unlimited traffic. Defaults to
   * false: a missing binding is allowed everywhere.
   */
  critical?: boolean;
};

/** true = allowed. development → always true. */
export async function enforceRate(
  limiter: RateLimiter | undefined,
  key: string,
  env: { ENVIRONMENT?: string },
  opts?: EnforceRateOptions
): Promise<boolean> {
  if (env.ENVIRONMENT === 'development') return true;
  if (!limiter) {
    if (opts?.critical) {
      // Log the limiter label only: the key suffix embeds the client IP, email or user id.
      const label = key.split(':')[0];
      const isProd = env.ENVIRONMENT === 'production';
      console.error(
        `[rate-limit] limiter binding missing (label=${label}, env=${isProd ? 'production' : 'non-production'}) — ${isProd ? 'denying (fail closed)' : 'allowing (non-prod)'}. Check wrangler.jsonc ratelimit bindings.`
      );
      return !isProd;
    }
    return true;
  }
  const { success } = await limiter.limit({ key });
  return success;
}

/** Canonical 429 copy per rate-bucket family. */
export const RATE_LIMIT_MESSAGES = {
  invites: 'Too many invites too quickly. Please slow down.'
} as const;

/** enforceRate for JSON mutation routes: throws the route's 429 itself on a hit. */
export async function enforceMutationRate(
  event: { platform?: App.Platform },
  key: string,
  opts: { limiter: RateLimiter | undefined; message: string; critical?: boolean }
): Promise<void> {
  const ok = await enforceRate(opts.limiter, key, event.platform!.env, {
    critical: opts.critical
  });
  if (!ok) throw error(429, opts.message);
}
