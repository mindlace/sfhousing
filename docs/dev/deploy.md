# Deployment

| Environment | Worker              | Host                             | D1 database         | wrangler selection |
| ----------- | ------------------- | -------------------------------- | ------------------- | ------------------ |
| production  | `sfhousing`         | `sfhousing.mindlace.net`         | `sfhousing`         | no `--env`         |
| staging     | `sfhousing-staging` | `sfhousing-staging.mindlace.net` | `sfhousing-staging` | `--env staging`    |

Both environments share one R2 bucket, `sfhousing`, so a dataset version uploaded once is visible to both. Each has its own D1 database and its own `PUBLISH_RL` namespace. Production is the top-level config in `wrangler.jsonc`: omitting `--env` selects it. Staging uses `--env staging`.

## Release flow

Releases run only after CI has been proven locally (via [chreode](https://github.com/mindlace/chreode)). "Proven" is a GitHub commit status with context `chreode/signoff`, which branch protection on `main` requires (strict, admins enforced, linear history, squash-only merges).

1. Work on a PR branch. Run `npm run signoff` (`chreode signoff`, configured by `chreode.config.ts`): it merges `origin/main`, plans the steps the changes since the last signoff need (rules map paths to steps; a path no rule matches runs everything), runs them under a machine-wide lock, pushes the branch (so do not `git push` first), and posts `chreode/signoff` on the head SHA with your own `gh` auth. `npm run signoff -- --dry-run` prints the plan; `-- --full` runs every step.
2. Squash-merge the PR. The push to `main` runs `deploy-staging.yml` (build, apply D1 migrations to `sfhousing-staging`, deploy `--env staging`). Staging deploys on every push to `main` and waits for nothing.
3. The same push runs `release-please.yml`, which opens or updates the release PR and posts `chreode/signoff` on its head SHA with `GITHUB_TOKEN` (`statuses: write`). Release PRs change only versions and `CHANGELOG`, and the code was already signed off.
4. Merge the release PR. release-please publishes release `vX.Y.Z`, and `deploy-prod.yml` (`on: release: published`) builds the tag, applies migrations to `sfhousing` and deploys production.

release-please runs with a GitHub App token (`actions/create-github-app-token`), not `GITHUB_TOKEN`. GitHub suppresses workflow runs for events emitted by `GITHUB_TOKEN`, so a release it published would never trigger `deploy-prod.yml`. The App is a distinct actor, so the `release: published` event propagates.

There is no automated staging-to-prod interlock (as in planafoot): do not merge a release PR over a red staging deploy.

`npm run signoff` is the only required check, and it runs locally. No workflow runs on pull requests.

`PUBLIC_APP_RELEASE` is set at deploy time to the commit SHA (staging) or tag (production).

A tab left open across a deploy that moves the game's state to a new version (version 3, the policy rounds) can read back, from its account, a game it cannot parse until it reloads.

`wrangler.jsonc` holds two Durable Object migrations, the same in both environments, applied by the deploy with no manual step. `v1-sim-object` created the class `SimObject` (`new_sqlite_classes`). `v2-delete-sim-object` deletes it and its stored data (`deleted_classes`); the Worker binds no Durable Object. A migration tag is never edited or reused.

### Contributors (fork PRs)

Only a maintainer can sign off a contributor's PR. The maintainer runs `gh pr checkout <n>` then `npm run signoff`. Signoff pushes to the PR's head branch only if the maintainer has push rights to it; otherwise re-open the PR from a branch in this repo and sign that off.

## Datasets ship with their code

Nothing is promoted. The build computes the dataset version `<v>` from the source tree (`treeDatasetVersion`, injected as `__SFH_DATASET_VERSION__` by `scripts/lib/dataset-version-plugin.ts`), so a given commit always asks for the same dataset. `wrangler.jsonc` carries no `PUBLIC_DATASET_VERSION`; `scripts/wrangler-config.spec.ts` requires it absent in both environments.

- **Guard.** Both deploy workflows run the step "Guard: this commit's dataset is published" before `npm run build`. It runs `npx tsx scripts/dataset-version.ts --check <host>` and sends a `HEAD` request (Node `fetch`, 15 s timeout, retried) for `/data/<v>/manifest.json` on the deployed host (either host serves any published version, so no R2 credentials are needed). If the manifest is missing the job fails without deploying and the running version stays up. The fix is to build and upload the dataset ([pipeline.md](pipeline.md), "Finishing a branch that changes the dataset").
- **Smoke.** After the deploy, "Smoke: dataset manifest is served and the build uses it" checks the manifest again and that `/about` on the deployed host shows `<v>` (`/attribution` is a 308 to `/about#about-data`, and `curl -fsS` does not follow it).
- **Reach check.** Before `upload`, `npx tsx scripts/reach-check.ts pipeline/out/<v>` must exit 0. Exit 1 means the twelve policies, all on at their fixed values, miss the goal inside the window on that data: nothing is uploaded, and the owner decides the remedy ([game.md](game.md), "The reach check").
- **Releases.** A release tag's tree computes its own `<v>`, so cutting a release is what moves production to a new dataset. `release-please.yml` needs no dataset step.
- **Rollback** is a code revert. The reverted tree computes the old version, which is still in R2.
- Versions are immutable and retained forever. There are no `chore(data)` or `data:` pointer PRs any more.
- A dirty local tree bakes in a version that was never published, so a local `npm run build` of uncommitted pipeline edits is not deployable. `npm run pipeline -- version [--check [<origin>]]` prints the tree's version; with `--check` it exits 1 unless `<origin>` (staging when bare) serves its manifest, and refuses a dirty tree.

## Secrets and variables

- Variables: `RELEASE_PLEASE_APP_ID` (present, unused by v3 of the token action), `RELEASE_PLEASE_CLIENT_ID`, `CLOUDFLARE_ACCOUNT_ID`.
- Secrets: `RELEASE_PLEASE_APP_PRIVATE_KEY`, `CLOUDFLARE_API_TOKEN`.

These are the GitHub Actions ones; nothing else is set there.

### Worker (set in Cloudflare)

Already set: `BETTER_AUTH_SECRET` as a secret on staging and on production, each with its own value (never share one between them); `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY` on staging and on production, each environment with its own key (see [Sign-in mail](#sign-in-mail)).

In `wrangler.jsonc` `vars`, per environment: `ENVIRONMENT`, `AUTH_METHODS=magic-link,password,google,passkey` (the same in both), `SES_FROM` (needed even in mail log mode) and `PUBLIC_APP_RELEASE`.

Each of these only switches a feature on, and is read through a typed cast of `platform.env`:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: Google sign-in while `AUTH_METHODS` lists `google`. How they are made is under [Sign-in mail](#sign-in-mail).
- `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY`: make mail deliverable. Magic link is in effect exactly while both are set; without them mail runs in log mode (see [auth.md](auth.md), Mail). `SES_REGION` is unset, so mail goes through `us-west-1`. `EMAIL_PROVIDER=resend` with `RESEND_API_KEY` is the other provider the code accepts, and is unused.
- `BETTER_AUTH_URL`: base URL override; unset, the request origin is used.

See [auth.md](auth.md).

## Sign-in mail

Mail goes through Amazon SES in the AWS account planafoot uses, region `us-west-1`, with production access.

- **Identity:** `sfhousing.mindlace.net`, Easy DKIM at 2048 bits, MAIL FROM `mail.sfhousing.mindlace.net` with the SES default on MX failure. It is a subdomain because `mindlace.net` carries the owner's own mail.
- **From:** `SES_FROM` in `wrangler.jsonc`, the same in both environments.
- **Senders:** one IAM user per environment, `sfhousing-mail-staging` and `sfhousing-mail-production`, each with the inline policy `send-from-sfhousing`:

  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "SendFromSfhousing",
        "Effect": "Allow",
        "Action": "ses:SendEmail",
        "Resource": "arn:aws:ses:us-west-1:<account>:identity/sfhousing.mindlace.net"
      }
    ]
  }
  ```

- **Keys:** each user holds one access key, set as that environment's two secrets. No copy of a key is kept anywhere but the Worker secret.

### DNS records

The zone `mindlace.net` is on Cloudflare. Names are relative to it. The CNAMEs must be "DNS only" (grey cloud): a proxied DKIM record never verifies. TTL is Auto. No record sits at `sfhousing.mindlace.net` itself.

| Name                           | Type  | Content                                              | Proxy         |
| ------------------------------ | ----- | ---------------------------------------------------- | ------------- |
| `<token>._domainkey.sfhousing` | CNAME | `<token>.dkim.amazonses.com`                         | DNS only      |
| `<token>._domainkey.sfhousing` | CNAME | `<token>.dkim.amazonses.com`                         | DNS only      |
| `<token>._domainkey.sfhousing` | CNAME | `<token>.dkim.amazonses.com`                         | DNS only      |
| `mail.sfhousing`               | MX    | `feedback-smtp.us-west-1.amazonses.com`, priority 10 | Not proxiable |
| `mail.sfhousing`               | TXT   | `v=spf1 include:amazonses.com ~all`                  | Not proxiable |
| `_dmarc.sfhousing`             | TXT   | `v=DMARC1; p=quarantine; adkim=r; aspf=r`            | Not proxiable |

The three `<token>` values are the identity's DKIM tokens, one per CNAME:

```sh
aws sesv2 get-email-identity --region us-west-1 --email-identity sfhousing.mindlace.net --query DkimAttributes.Tokens --output text
```

### Health check

```sh
aws sesv2 get-email-identity --region us-west-1 --email-identity sfhousing.mindlace.net \
  --query '{sending:VerifiedForSendingStatus,identity:VerificationStatus,dkim:DkimAttributes.Status,mailFrom:MailFromAttributes.MailFromDomainStatus}'
```

Healthy: `sending` is `true`, and `identity`, `dkim` and `mailFrom` are all `SUCCESS`.

### Commands per environment

Every command below starts with this prelude, in the same shell command. `E` is the one parameter:

```sh
E=staging   # the one parameter: staging or production
U="sfhousing-mail-$E"
ENVF=(); [ "$E" = staging ] && ENVF=(--env staging)
HOST=$([ "$E" = staging ] && echo sfhousing-staging.mindlace.net || echo sfhousing.mindlace.net)
```

`ENVF` is an array, so `"${ENVF[@]}"` expands to nothing for production and to `--env staging` for staging, in bash and in zsh.

#### Rotate a key

The user has one key. A rotation makes a second, swaps the secrets, proves a mail, and deletes the first (prelude first):

```sh
OLD=$(aws iam list-access-keys --user-name "$U" --query 'AccessKeyMetadata[0].AccessKeyId' --output text) && \
[ "$(aws iam list-access-keys --user-name "$U" --query 'length(AccessKeyMetadata)' --output text)" = 1 ] && \
read -r KEY_ID KEY_SECRET <<<"$(aws iam create-access-key --user-name "$U" \
  --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)" && \
printf '%s' "$KEY_ID" | npx wrangler secret put SES_ACCESS_KEY_ID "${ENVF[@]}" && \
printf '%s' "$KEY_SECRET" | npx wrangler secret put SES_SECRET_ACCESS_KEY "${ENVF[@]}" && \
echo "old key ends ${OLD: -4}"
```

1. Run the block above. It refuses unless the user has exactly one key.
2. Send a proof mail: submit the `/signin` form's `sendLink` action on the same environment (`curl -sS -X POST "https://$HOST/signin?/sendLink" -H "Origin: https://$HOST" -H 'Accept: application/json' -H 'x-sveltekit-action: true' --data-urlencode 'identifier=<address>'`). It must answer `"type":"success"`.
3. Delete the old key, the one of the user's two keys with the older `CreateDate` in `aws iam list-access-keys --user-name "$U"`, whose last four characters the block printed: `aws iam delete-access-key --user-name "$U" --access-key-id <old key id>`.

Mail keeps flowing throughout: the old key works until it is deleted.

#### Turn mail off on one environment

Rollback for one environment (prelude first). Magic link goes off there at once; the other environment keeps sending:

```sh
npx wrangler secret delete SES_ACCESS_KEY_ID "${ENVF[@]}"
npx wrangler secret delete SES_SECRET_ACCESS_KEY "${ENVF[@]}"
for k in $(aws iam list-access-keys --user-name "$U" --query 'AccessKeyMetadata[].AccessKeyId' --output text); do
  aws iam delete-access-key --user-name "$U" --access-key-id "$k"
done
aws iam delete-user-policy --user-name "$U" --policy-name send-from-sfhousing
aws iam delete-user --user-name "$U"
```

#### Remove everything

Run the rollback above for both environments. Then delete the identity, and have the owner remove the six DNS records:

```sh
aws sesv2 delete-email-identity --region us-west-1 --email-identity sfhousing.mindlace.net
```

### Google sign-in

Google sign-in shows once its two secrets are on an environment and `AUTH_METHODS` lists `google`. The client secret is the owner's to make and to set. In the owner's Google Cloud console, one project for the site:

1. Google Auth Platform, Branding: app name `SF Housing`, the owner's support and developer contact address, home page `https://sfhousing.mindlace.net`, authorised domain `mindlace.net`.
2. Audience: External, published to production, so any Google account can sign in.
3. Data access: the scopes `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile` only. These need no Google review.
4. Clients, Create client: type Web application, name `sfhousing`.
5. Authorised JavaScript origins: `https://sfhousing.mindlace.net` and `https://sfhousing-staging.mindlace.net`.
6. Authorised redirect URIs: `https://sfhousing.mindlace.net/api/auth/callback/google` and `https://sfhousing-staging.mindlace.net/api/auth/callback/google`.

One client serves both environments. Paste the client id and secret at each prompt:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID --env staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
```

Check: `npx wrangler secret list` and `npx wrangler secret list --env staging` each list both names.

## One-time bootstrap

Done:

- [x] D1 databases created (2026-10-10, WNAM): `sfhousing` `08b75fb1-bf24-4d3d-88b2-f236a6be5f77`, `sfhousing-staging` `7975fab5-91fd-4947-8e88-af64bdc6e251` (ids are in `wrangler.jsonc`).
- [x] R2 bucket `sfhousing` created.
- [x] GitHub repo `mindlace/sfhousing` exists.
- [x] release-please App credentials configured as repository variables.
- [x] First real dataset uploaded (X1, 2026-10-11): `2026-10-11-697b4599` (918 objects) in R2; `PUBLIC_DATASET_VERSION` was bumped to it for production and staging in `wrangler.jsonc` (history: the version is now computed from the tree).
- [x] SES identity `sfhousing.mindlace.net` verified in `us-west-1` (DKIM and MAIL FROM), its six DNS records at Cloudflare (2026-11-22).
- [x] IAM users `sfhousing-mail-staging` and `sfhousing-mail-production`; SES secrets on staging and production; a sign-in mail accepted by SES on each (2026-11-22).

Remaining:

- [ ] Set the two secrets (`CLOUDFLARE_API_TOKEN`, `RELEASE_PLEASE_APP_PRIVATE_KEY`).
- [ ] Create the `staging` and `production` GitHub environments if they do not exist.
- [x] Branch protection requires chreode/signoff (applied by `npm run branch-protection` during the chreode adoption).
- [ ] Attach the custom domains (declared as `custom_domain` routes in `wrangler.jsonc`; the zone must be on the Cloudflare account).
- [ ] Google OAuth client and `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` on staging and production (owner; see Sign-in mail).
- [ ] Owner confirms DKIM, SPF and DMARC pass in the received headers of the staging and production sign-in mails.
