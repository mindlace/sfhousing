# Code-derived dataset version: code and data land together

Status: draft for discussion (2026-11-08)

## Why

Every new dataset currently takes two hand-made PRs. One bumps `env.staging.vars.PUBLIC_DATASET_VERSION` in `wrangler.jsonc` (`chore(data): point staging at …`). A later one bumps the top-level var (`data: point production at …`). There are a dozen such commits in the log. Worse, code and data reach an environment at different moments. Staging can run new code against an old dataset, or an old one against new code. And `2026-11-02-0d40e1e2` reached staging but never prod.

Wanted (owner's words):

1. Staging always runs the latest dataset, with no env var involved.
2. release-please releases automatically bump prod to the latest dataset.
3. Code changes on staging land "with" their dataset changes.

Context from the owner: every dataset change so far has come with a code change, and the owner releases to prod only after they are satisfied with staging.

## Idea

`datasetVersion` is already a pure function of the committed tree: `computeDatasetVersion({ lock, codeHash, toolVersions })` in `pipeline/lib/version.ts`. Its inputs are the committed `pipeline/sources.lock.json`, `codeTreeHash` (a `git ls-tree` listing of the pipeline and shared-code paths) and the constant `TOOL_VERSIONS` in `pipeline/config.ts`. So a build of the app can compute the dataset version from its own source tree and bake it in. **The code decides which data it runs on.** Every deploy, whether staging from `main` or prod from a release tag, ships the dataset its code was built for. There is no version to bump, no pointer and no env var.

Rejected alternative: a mutable "latest" pointer in R2 (an earlier draft of this spec). It needed a guard for ordering code against data, a release-PR bump step and a rollback command, and it still left a window where code and data were out of step.

## Design

### 1. The version comes from the tree at build time

- Add a step at app build time that computes `datasetVersion` from the checked-out tree (the same `computeDatasetVersion` + `codeTreeHash` + `TOOL_VERSIONS`) and makes it available to the server as a build-time constant. A generated module or a Vite `define` would both do; the choice is left to the builder.
- The root layout load uses that constant. `PUBLIC_DATASET_VERSION` survives **only as a local override**. It is honoured when `ENVIRONMENT=development` (`npm run dev`, `npm run preview`, e2e against `fixture-0` through `.dev.vars`) and ignored or refused in deployed environments. *(My call: dev and e2e must keep running on `fixture-0` without a real build.)*
- `wrangler.jsonc` drops `PUBLIC_DATASET_VERSION` from both `vars` and `env.staging.vars`. `scripts/wrangler-config.spec.ts` changes to require it absent in both.
- A dirty tree computes a different version, which is what `codeTreeHash` does today. CI checkouts are clean. A local `npm run build` with uncommitted pipeline edits bakes in a version that doesn't exist, and that is correct.
- `computeDatasetVersion` stays the single source of truth for pipeline `build` and app build alike. There is no second implementation.
- The version still reaches the client only as layout data, never as a global. Saved plans keep recording `datasetVersion`. Old versions stay in R2, so saved plans keep loading.

### 2. Deploys refuse to ship code without its data

- `deploy-staging.yml` and `deploy-prod.yml` compute `<v>` from the checked-out commit, before `wrangler deploy`. They then check that `data/<v>/manifest.json` is served, by `curl`ing `/data/<v>/manifest.json` on the currently deployed host. Either host serves any published version, so no R2 credentials are needed. If the manifest is missing, the job fails before deploying, and the running version stays up.
- The existing post-deploy smoke step keeps working, but reads `<v>` from the same computation instead of `wrangler.jsonc`. `scripts/dataset-version.ts` is rewritten accordingly.
- `release-please.yml` needs no change. A release tag's tree computes its own version, so cutting a release is what bumps prod.

### 3. Signoff refuses a branch whose dataset isn't published

- A new chreode step, `dataset`, computes `<v>` for the signed-off tree and checks that `/data/<v>/manifest.json` is served on staging. It fails with the build and upload commands to run if not. It is cheap: no build, one HTTP request.
- It triggers on the code-hash paths (the `src/lib/data/**`, generator, timelapse, scenario, levers and scoreboard rule, plus `pipeline/**` and the lock, which today match no rule and therefore run everything). This makes the guard pre-merge: a dataset-changing branch cannot get `chreode/signoff` until its dataset is uploaded.
- Release PRs carry the auto-signoff and touch no code-hash paths, so the step doesn't affect them.

### 4. Finishing a branch that changes the dataset (owner's rule)

When a worktree branch changes `datasetVersion`, building and uploading the dataset is part of finishing the branch:

1. `git merge origin/main`. The version hashes the merged code, so merge first.
2. `npm run pipeline -- build`.
3. `npm run pipeline -- upload <v>`.
4. `npm run pipeline -- verify <v> --origin <staging>`. Staging already serves any published `/data/<v>/`.
5. `npm run signoff`. The `dataset` step passes now. If `origin/main` moved in the meantime, signoff's merge changes `<v>`, the step fails, and the loop goes back to step 2.
6. Open the PR and squash-merge it. Squashing doesn't change the tree, so `main` computes the same `<v>`. Staging deploys the code and its dataset together.
7. Remove the worktree.

Add `npm run pipeline -- version`, which prints the `<v>` the current tree computes, so a session can tell whether a branch changes the dataset before it starts finishing. The sequence goes in `docs/dev/pipeline.md` ("Release run order" is rewritten) and is linked from `CLAUDE.md` Conventions. Builds need `pipeline/.cache` and tippecanoe and pmtiles locally. A worktree without the cache fetches from the committed lock first.

### 5. Docs

- `docs/dev/deploy.md`: "Promoting a datasetVersion" is replaced. There is nothing to promote: the dataset ships with its code. Rollback is a code revert, after which the reverted tree computes the old version, which is still in R2.
- `docs/dev/pipeline.md`: release run order (above), and a note that the code-hash paths are now load-bearing for deploys too.
- `docs/dev/developing.md`: `.dev.vars` `PUBLIC_DATASET_VERSION` is a dev-only override.

## Costs (accepted)

- **Any change to a code-hash path needs a build and upload before merging**, including changes that don't affect the data (a pipeline test, a refactor, a comment in `src/lib/data/`). That costs about 8 minutes of build plus an upload, and needs the source cache. Narrowing `PATHS` in `pipeline/lib/version.ts` would reduce this. That's out of scope, but now worth doing.
- **More immutable versions in R2**, one per dataset-changing merge. Retention stays "forever".

## Non-goals

- Changing the version name format.
- A way to hold prod on an older dataset while shipping newer code. The owner doesn't need it.
- A release that changes only the dataset. Data can't change without the tree changing, and the tree changing produces a releasable commit.
- Garbage-collecting old versions.

## Left to the builder

- How the constant is generated and injected (generated module vs `define`), and keeping it out of the client bundle except as layout data.
- Making `computeDatasetVersion` / `TOOL_VERSIONS` importable from build tooling without pulling in pipeline-only dependencies.
- Making `actions/checkout`'s default shallow clone work with `git ls-tree HEAD` (it should), and handling the "uncommitted changes" branch of `codeTreeHash` in CI.
- How the `dataset` chreode step reads the staging origin (`STAGING_ORIGIN` in `pipeline/steps/upload.ts` already exists).
