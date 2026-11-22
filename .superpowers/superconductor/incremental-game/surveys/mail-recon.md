# Recon note: sign-in mail, passkeys and Google (read-only)

Investigator agent, 2026-11-22. Reads only: repo files, `npx wrangler secret list`, `aws` list/get calls. Testimony until re-read.

## sfhousing code

- Providers: `ses` and `resend`, else log mode. Selector `src/lib/server/email/provider.ts:17-22`: `resend` when `EMAIL_PROVIDER` is `resend` and `RESEND_API_KEY` is set; else `ses` when `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY` are set; else none.
- Env names read: `EMAIL_PROVIDER`, `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`, `RESEND_API_KEY`, `SES_REGION` (default `us-west-1`), `SES_FROM` (required even in log mode).
- Log mode: `sendEmail` logs `[email:log-mode]` and returns `{ sent: false, logged: true }`. `mailCanBeDelivered` is true only with a provider (`provider.ts:25-27`).
- `AUTH_METHODS` accepts `magic-link`, `password`, `passkey`, `google` (`src/lib/server/auth/methods.ts:11`). `enabledAuthMethods` (`methods.ts:53-62`) drops `magic-link` unless mail can be delivered (e2e builds excepted) and drops `google` unless `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are both set (`google-provider.ts:8-13`). `passkey` needs only the token.
- Passkey relying party: `rpID` is the hostname of `BETTER_AUTH_URL` or of the request origin (`better-auth.ts:115-116, 323-328, 341`), so production and staging passkeys are separate and need no config.
- `wrangler.jsonc` both environments: `AUTH_METHODS="magic-link"`, `SES_FROM="SF Housing Simulator <noreply@sfhousing.mindlace.net>"`. No `SES_REGION`.
- `npx wrangler secret list`: only `BETTER_AUTH_SECRET` on production and on staging. So no mail provider is configured, and magic-link sign-in is off in production today.
- `docs/dev/deploy.md:60` says the SES secrets give "real mail delivery" and magic link "is off until then"; its bootstrap checklist (`:107-119`) has no mail item.

## planafoot

- `wrangler.jsonc:102-104`: `SES_REGION=us-west-1`, `SES_FROM=no-reply@planafoot.com`, `SES_ACCESS_KEY_ID` as vars; `SES_SECRET_ACCESS_KEY` a secret.
- `docs/dev/email.md`: domain identity planafoot.com, custom MAIL FROM `mail.planafoot.com`, Easy DKIM (three CNAMEs), a DMARC ramp, production access, IAM `ses:SendEmail` on the identity ARN. mindlace.net is the Google Workspace primary domain (`email.md:87`).

## AWS (account ending 1215, default region us-west-1)

- us-west-1 has production access: 50,000 a day, 14 a second. us-east-1 and us-west-2 are in the sandbox with no identities.
- Identities in us-west-1: `planafoot.com` (domain, verified, DKIM and MAIL FROM verified), `traceclue.com` (domain, verified), one single-address identity at mindlace.net. No identity for mindlace.net or sfhousing.mindlace.net.
- IAM: one user, `planafoot`, policy `send-email` allowing `ses:SendEmail` on `*`. Two active keys.
- Route 53 has no hosted zones: mindlace.net DNS is elsewhere (the owner uses Cloudflare; inferred).

## Missing, in order

1. AWS: an SES domain identity in us-west-1 for `sfhousing.mindlace.net` with Easy DKIM, and a custom MAIL FROM `mail.sfhousing.mindlace.net`.
2. DNS at the mindlace.net host: three DKIM CNAMEs; for MAIL FROM an MX and an SPF TXT; a DMARC TXT.
3. AWS: an IAM user for sfhousing allowed `ses:SendEmail` on that identity only, and one access key.
4. Cloudflare secrets on production and staging: `SES_ACCESS_KEY_ID`, `SES_SECRET_ACCESS_KEY`.
5. A real sign-in mail on staging to prove delivery.
6. Google: an OAuth client in the owner's Google Cloud console with redirect URIs `https://<host>/api/auth/callback/google` for both hosts (the path is inferred from Better-Auth's convention, not read in code), then `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on both environments.

## Not determined

- Where mindlace.net DNS is hosted (not queried).
- Whether a subdomain identity interacts with the root domain's DMARC.
