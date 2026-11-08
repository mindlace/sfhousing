# Dataset pointer: staging runs the latest, releases bump prod

Status: draft for discussion (2026-11-08)

## Why

Every new dataset currently takes two hand-made PRs. One bumps `env.staging.vars.PUBLIC_DATASET_VERSION` in `wrangler.jsonc` (`chore(data): point staging at …`). A later one bumps the top-level var (`data: point production at …`), and that PR is what makes release-please cut a release. There are a dozen such commits in the log. They are pure ceremony: the dataset is already uploaded, validated by `upload`'s checks, and immutable.

Wanted (owner's words):

1. Staging always runs the latest dataset, with no env var involved.
2. release-please releases automatically bump prod to the latest dataset.

## Decided

- **"Latest" means "most recently uploaded"**, recorded by a mutable pointer object in R2. It does not mean the highest version name: names do not sort (three versions share `2026-11-02`, and the hash part has no order). Sortable names were considered and rejected: versions are immutable, so a bad upload could never be skipped, and listing R2 would surface half-uploaded versions. The pointer gives rollback for free and is written only after the manifest, so it can only name a complete version.
- **Pointer key:** `data/latest.json` in bucket `sfhousing`, body `{ "datasetVersion": "<v>" }`. One pointer is shared by both environments; prod reads it only at release time.

## Design

### 1. Writing the pointer

- `pipeline upload <v>` writes `data/latest.json` as its last step, after `manifest.json` succeeds. A failed upload leaves the pointer untouched. Applies to `--local` as well, so local R2 behaves like remote.
- New command `pipeline point <v> [--local]` sets the pointer to an already-published version, for rollback or for re-pointing. It refuses unless `data/<v>/manifest.json` exists in the target bucket and parses with `datasetVersion === v`. *(My call: the owner hasn't decided between this and "roll back by re-uploading"; re-uploading an immutable version is refused today, so a command is the only clean path.)*
- `upload` gets a `--no-point` flag for publishing a version without making it latest. *(My call.)*
- **Code/data ordering guard.** Today a hand-made PR keeps staging from pointing at a dataset before the pipeline code that built it is on `main`. The pointer removes that PR, so `upload` (and `point`) move the remote pointer only when the working tree is clean and `HEAD` is contained in `origin/main`. Otherwise they publish the version, leave the pointer alone, and print the `pipeline point <v>` command to run after the merge. `--local` is exempt. *(My call: the builder check raised this.)*
- `npm run data:fixture` and `npm run data:local` also write the local pointer, so dev without a `.dev.vars` version works the same way.
- Cache headers on the pointer: `no-store`. It is mutable, unlike everything under `data/<v>/`.

### 2. Reading the pointer at runtime (staging)

- The root layout load resolves the dataset version in this order: (a) `PUBLIC_DATASET_VERSION` if set; (b) otherwise `data/latest.json` from the `BUCKET` binding. Prod keeps (a). Staging drops the var and uses (b). Dev keeps `.dev.vars` working, and falls back to (b) when the var is absent.
- The read is cached in the isolate for 60 s *(my call)*, so a new upload reaches staging within about a minute with no PR and no redeploy.
- Failure behaviour: if the pointer is missing or malformed and there is no cached value, return a 500 with a clear message, matching `requireDatasetVersion`'s "never fall back to a default" rule. If a cached value exists, a failed refresh keeps serving it and logs the error.
- The version still reaches the client only as layout data, never as a global. Saved plans keep recording `datasetVersion`, exactly as today.
- `env.staging.vars.PUBLIC_DATASET_VERSION` is removed from `wrangler.jsonc`. `scripts/wrangler-config.spec.ts` changes to require it to be **absent** for staging and still a real `YYYY-MM-DD-<8 hex>` for prod.
- The staging deploy smoke step reads the pointer (`wrangler r2 object get sfhousing/data/latest.json --remote`) and curls that version's manifest on the staging host.

### 3. Prod bump through release-please

- In `release-please.yml`, after the release-please step and **before** auto-signoff: when a release PR exists, read the remote pointer. If it differs from the top-level `PUBLIC_DATASET_VERSION` on the PR branch, commit the bump to the release PR branch, with message `data: point production at dataset <v>`, using the App token. Auto-signoff then signs the resulting head SHA.
- release-please force-pushes its branch on every push to `main`, so the step runs on every workflow run and must be idempotent.
- So the prod version **is recorded in git**: it is in the tagged commit, the release PR diff shows it, and rebuilding a tag deploys the same dataset. `deploy-prod.yml` keeps reading the var from `wrangler.jsonc` and needs no change. *(My call: the owner was asked "git or release notes" and hasn't answered. Git keeps tag rebuilds reproducible.)*
- The workflow needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to read R2. The token must have R2 read access.

### 4. Docs

- `docs/dev/deploy.md` "Promoting a datasetVersion" is rewritten: upload → staging has it within a minute → the next release takes it to prod. Rollback goes through `pipeline point`.
- `docs/dev/pipeline.md` and `docs/dev/data-serving.md` note `data/latest.json` (mutable, `no-store`, outside the `/data/<version>/` route contract).

## Non-goals

- Changing the version name format.
- Serving `latest.json` over HTTP. The worker reads it through the binding. *(My call; it can be added later if needed.)*
- Deleting or garbage-collecting old versions.

## Owner answers (2026-11-08)

- **No prod hold.** Every release PR takes whatever the pointer names. Merging the release PR is the check: look at staging first. To revert prod, move the pointer back with `pipeline point` and cut a release. A hand edit of the prod var is overwritten by the next release-PR update, and the docs say so.
- **A new upload does not trigger a release by itself.** Every dataset change so far has come with a code change, and that code change's `feat`/`fix` commit opens the release PR that carries the dataset bump. A release that changes only the dataset, if one is ever needed, is cut by hand. The docs say how. Revisit this if dataset-only changes become common.

## Left to the builder

- Where the resolver lives (extend `src/lib/server/config/dataset-version.ts` or add a sibling), the cache mechanics, and test shape (`FakeR2Bucket` for the layout load, Playwright against workerd for the real binding).
- The exact shell for the release-PR bump step: reading and writing `wrangler.jsonc` should reuse `scripts/lib/wrangler-config.ts` instead of `sed`, keeping comments intact.
