// Publish rate limiting over the Workers rate-limit binding (PUBLISH_RL). Fails closed in
// production when the binding is missing; development (e2e preview, local dev) always allows.

export type RateLimiter = { limit(opts: { key: string }): Promise<{ success: boolean }> };

/**
 * true = allowed. development → always true. Missing binding: production → false (fail closed,
 * console.error with label only), other envs → true.
 */
export async function enforceRate(
  limiter: RateLimiter | undefined,
  key: string,
  env: { ENVIRONMENT?: string }
): Promise<boolean> {
  if (env.ENVIRONMENT === 'development') return true;
  if (!limiter) {
    // Log the limiter label only: the key suffix embeds the client IP.
    const label = key.split(':')[0];
    const isProd = env.ENVIRONMENT === 'production';
    console.error(
      `[rate-limit] limiter binding missing (label=${label}, env=${isProd ? 'production' : 'non-production'}) — ${isProd ? 'denying (fail closed)' : 'allowing (non-prod)'}. Check wrangler.jsonc ratelimit bindings.`
    );
    return !isProd;
  }
  const { success } = await limiter.limit({ key });
  return success;
}
