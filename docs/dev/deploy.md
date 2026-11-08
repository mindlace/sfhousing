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

There is no CI workflow on pull requests: `npm run signoff` is the only check, and it runs locally. Add a workflow deliberately if checks move off the maintainer's machine.

`PUBLIC_APP_RELEASE` is set at deploy time to the commit SHA (staging) or tag (production).

### Contributors (fork PRs)

Only a maintainer can sign off a contributor's PR. The maintainer runs `gh pr checkout <n>` then `npm run signoff`. Signoff pushes to the PR's head branch only if the maintainer has push rights to it; otherwise re-open the PR from a branch in this repo and sign that off.

## Datasets ship with their code

Nothing is promoted. The build computes the dataset version `<v>` from the source tree (`treeDatasetVersion`, injected as `__SFH_DATASET_VERSION__` by `scripts/lib/dataset-version-plugin.ts`), so a given commit always asks for the same dataset. `wrangler.jsonc` carries no `PUBLIC_DATASET_VERSION`; `scripts/wrangler-config.spec.ts` requires it absent in both environments.

- **Guard.** Both deploy workflows run the step "Guard: this commit's dataset is published" before `npm run build`. It runs `npx tsx scripts/dataset-version.ts --check <host>` and sends a `HEAD` request (Node `fetch`, 15 s timeout, retried) for `/data/<v>/manifest.json` on the deployed host (either host serves any published version, so no R2 credentials are needed). If the manifest is missing the job fails without deploying and the running version stays up. The fix is to build and upload the dataset ([pipeline.md](pipeline.md), "Finishing a branch that changes the dataset").
- **Smoke.** After the deploy, "Smoke: dataset manifest is served and the build uses it" checks the manifest again and that `/attribution` on the deployed host shows `<v>`.
- **Releases.** A release tag's tree computes its own `<v>`, so cutting a release is what moves production to a new dataset. `release-please.yml` needs no dataset step.
- **Rollback** is a code revert. The reverted tree computes the old version, which is still in R2.
- Versions are immutable and retained forever. There are no `chore(data)` or `data:` pointer PRs any more.
- A dirty local tree bakes in a version that was never published, so a local `npm run build` of uncommitted pipeline edits is not deployable. `npm run pipeline -- version [--check [<origin>]]` prints the tree's version; with `--check` it exits 1 unless `<origin>` (staging when bare) serves its manifest, and refuses a dirty tree.

## Secrets and variables

- Variables: `RELEASE_PLEASE_APP_ID` (present, unused by v3 of the token action), `RELEASE_PLEASE_CLIENT_ID`, `CLOUDFLARE_ACCOUNT_ID`.
- Secrets: `RELEASE_PLEASE_APP_PRIVATE_KEY`, `CLOUDFLARE_API_TOKEN`.

Nothing else.

## One-time bootstrap

Done:

- [x] D1 databases created (2026-10-10, WNAM): `sfhousing` `08b75fb1-bf24-4d3d-88b2-f236a6be5f77`, `sfhousing-staging` `7975fab5-91fd-4947-8e88-af64bdc6e251` (ids are in `wrangler.jsonc`).
- [x] R2 bucket `sfhousing` created.
- [x] GitHub repo `mindlace/sfhousing` exists.
- [x] release-please App credentials configured as repository variables.
- [x] First real dataset uploaded (X1, 2026-10-11): `2026-10-11-697b4599` (918 objects) in R2; `PUBLIC_DATASET_VERSION` was bumped to it for production and staging in `wrangler.jsonc` (history: the version is now computed from the tree).

Remaining:

- [ ] Set the two secrets (`CLOUDFLARE_API_TOKEN`, `RELEASE_PLEASE_APP_PRIVATE_KEY`).
- [ ] Create the `staging` and `production` GitHub environments if they do not exist.
- [x] Branch protection requires chreode/signoff (applied by `npm run branch-protection` during the chreode adoption).
- [ ] Attach the custom domains (declared as `custom_domain` routes in `wrangler.jsonc`; the zone must be on the Cloudflare account).
