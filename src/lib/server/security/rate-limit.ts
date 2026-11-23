// Rate limiting over the Workers rate-limit bindings: PUBLISH_RL, AUTH_LINK_RL,
// AUTH_PASSWORD_RL, PSEUDO_MINT_RL, ACCOUNT_EDIT_RL, and MUTATION_REGISTERED_RL for saved
// games. development (e2e preview, local dev) always allows.

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
