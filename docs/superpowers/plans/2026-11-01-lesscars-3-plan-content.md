# /lesscars Plan 3 of 3: Wiring the Approved Plan into the Live Build (outline)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: outline. Gated:** do not start until `docs/lesscars/plan-v1.md` (Plan 1, Task 1) carries the owner's approval line in place of `Owner review: pending`, and Plan 1 has merged. Expand into a full plan then; its content depends on what the owner approved.

**Goal:** The live dataset carries the owner-approved fewer-cars plan: `pipeline/enrichment/lesscars/plan.json`, the live street centrelines in the lock, a full local build with the paired runs, and the measured answer recorded.

**Architecture:** No new mechanism. Plan 1's step reads `LESSCARS_PLAN_JSON.live` when it exists; this plan creates it and runs the release build locally (heavy work off CI).

**Spec:** `docs/superpowers/specs/2026-11-01-lesscars-design.md` ("Drafting the plan", "How it gets made", "Heavy work stays off CI").

## Global Constraints

- The plan file is a transcription of the approved document's Appendix A: no number enters `plan.json` without its tier and source from the document; a change found necessary while wiring goes back to the owner, not into the file silently.
- The full paired run happens in the local `npm run pipeline -- build`, never in CI.
- Upload and the `PUBLIC_DATASET_VERSION` bump are partner actions (`docs/dev/pipeline.md`, Partner actions); this plan ends at a verified local build.

## Tasks (outline)

1. **Transcribe the plan.** `pipeline/enrichment/lesscars/plan.json` from Appendix A; a `pipeline/test/lesscars-live-plan.test.ts` that parses it, runs `checkPlan` and asserts every `Param` has a non-empty provenance label and every tier-4 label says "invented" or "unsourced". Commit.
2. **Lock the street centrelines.** `npm run pipeline -- fetch --only datasf-streets`; commit the lock entry; confirm `asOf` and the transit target date are unchanged (the source is in neither allowlist).
3. **Live build and measure.** `npm run pipeline -- build`; record the lesscars step time, the seed count, V35's detail, the headline (mean, p10, p90), the source breakdown, the regime days and the zero-yield site count in `docs/dev/lesscars.md` ("First live build"). If the build's lesscars step exceeds 30 minutes, reduce `LIVE_PROFILE.lesscarsSeeds` (keep it odd) and record the band width at both counts.
4. **Owner review of the answer.** Present the numbers and the map (Plan 2's page on a local dataset via `npm run data:local`) to the owner; changes to the plan go back through `docs/lesscars/plan-v1.md` and Task 1.
5. **Hand off the partner actions.** Upload, verify on staging, bump staging then production through a release, per `docs/dev/deploy.md`.
