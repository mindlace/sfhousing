# Decisions on the fidelity findings (2026-11-09)

Three fresh checkers read the package: `fidelity-seams.md` (X1 to X21), `fidelity-specs-a.md` (FM, FE, MB, FD) and `fidelity-specs-b.md` (S, L, U). Unless a finding is listed here with a different decision, **the fix is the checker's "smallest fix"**, applied in the spec named. The design is already amended for the design-level findings; its rows are re-copied into the specs by `sync-rows.mjs` after the fix round.

## Design-level, already applied

- **X1, FE-1 (`marketLevel`).** F3 now names `marketLevel(calibration): 'all' | 'private'`: `market-baseline` ships it returning `'all'`; `finance-engine` changes its body to F3's rule; `buildSimInput` and the page both call it.
- **X2 (step 0).** "Dependency order" item 0 now lists the declarations and their files, says step 0 has no spec and is dispatched by the conductor as the first change of Release 1, and says what it does not declare (`FinanceLevers`, `SimLevers.finance`, both schema-3 changes: `finance-levers`'s). `LimitStatement` is declared in `src/lib/timelapse/types.ts`. Every spec: where you "add" or "declare" one of step 0's types or optional fields, say instead that step 0 declares it and you add its behaviour.
- **X6 (releases).** "Dependency order" now has "How a release is built": one integration branch per release; subsystem branches merge into it with no upload and no signoff of their own; the release branch regenerates goldens and the fixture, builds and uploads the dataset once and signs off once. Release 1 is step 0, `finance-model`, `market-baseline`, `finance-data`. Release 2 is the other four. Every spec: reword your dataset-build, upload, golden and signoff passages to "at the release, on the release branch", and name which goldens your subsystem's change is expected to move.
- **X8 (guarantee loss).** F9 (h) now says a guarantee loses `lossOnExit` of the guaranteed principal, at most its reserve, as the engine and score specs already have it.
- **X10, FE-9, FD-4 (bounds).** F5: `debt.rate` above 0 and at most 0.25, `termYears` 1 to 40. F6: `minHomes` a whole number from 0 to 10,000; an instrument is valid when `validateInstrument` (`finance-model`) accepts it, and every validator calls it. `checkPool`, `checkProgramme`, `parseFinanceLevers`, the engine's validation and the tab's fields all use these bounds. The tab's fields accept any value a preset writes and show it at full precision.
- **X11 (rows built against but not embedded).** "Row ownership" now lists them: `market-baseline` also consumes F12; `finance-data` F2 and F8; `finance-levers` F1 and F4; `funding-ui` F1, F2, F4 and F9. Each of those specs adds the row line to its Interfaces section by copying it verbatim from the design (the script then keeps it in step).
- **X17, X18.** Design prose and the traceability table corrected.
- **X19.** `finance-score` then `finance-levers`, in sequence.
- **L-1, X13 (presets).** F16: `FundingPreset` gains `description: string` and `group: 'city' | 'bank' | 'state' | 'federal'`; `fundingPresets(calibration)` returns the list. `finance-levers` writes one description per preset; `funding-ui` shows it and groups by `group`.

## Decisions that differ from, or add to, the checker's fix

- **X7 (pro rata among the City's sources is unconfirmed).** It stays applied and marked in the design as awaiting the partner's confirmation. Specs treat it as the rule.
- **FM-1.** Drop "exactly": certainty and every coverage comparison go through `isCertain` and the 10⁻⁹ tolerance. **FM-2** as proposed. **FM-3.** Pin `INCLUSIONARY` to the Triennial table for this package; a later ordinance is a note for the conductor, not a change in the build. **FM-6.** Label the rounding rule tier 4 in the provenance unless section 415.6 is read and cited.
- **FE-2, X9 (ledger identities).** `finance-engine` states the identities (it owns the ledger); `finance-score` cites them and keeps its own numbering beside the engine's.
- **MB-1.** The hold-out is not in `today.provenance`; it stays in report section 11 only. **MB-2.** The spec's chart readings are the committed values.
- **FD-1.** Homes come from the CDLAC list; the CTCAC workbook is used only for 9% rows. List every award row in the spec, or say exactly which published list and filter produce them, with the expected sums. **FD-3, X21.** Fixture MOHCD rows of 2 and 6 homes (`minHomes` 2); with FD-2's band counts stated. `finance-engine` adds a check that a seed-1 run of `fixture-0` makes at least one funded start. **FD-9.** Add both facts to the notes.
- **S-7.** Keep F14 as written; say in `MONEY_SOURCES` and the developer doc that displacement by funded projects not yet complete is not counted.
- **L-6.** Re-read the HR&A plan and add the bank's years 4 and 5 if the plan gives them year by year; otherwise keep the three years and state the omission as a scope cut in the spec's open questions. A user who wants the state bond adds a `state` pool by hand: say so.
- **U-1, X5.** An unfinished pool or programme is page state, outside the store, until every required field is valid; it is then added in one store change. Autosave, undo, publish and the worker never see a draft. A draft is lost on reload; say so on the page while one is open.
- **U-2.** "What the City pays" and a programme's in-bundle figure use each item's grant, or grant-equivalent for a loan or guarantee, as priced in the bundle. The amount lent is shown separately ("lends $… a home, repaid at completion").
- **U-3.** A field whose value is a preset's tier 4 or unsourced starting value shows "custom, not sourced", through `valueSource`.
- **U-4, X20 (OD-F8).** The line reads "Grants paid to projects that stopped after construction began, counted as lost (assumption): {sum}. They are in Spent." with the share taken from the resolved `lossOnExit`; the column is "Loans and guarantees lost". The line is shown whenever the sum is above 0, inside "Money details".
- **U-8.** As proposed: a City-group change is shown once and removed as one; a change on the same pool and day replaces the old one; entries are sorted on insert; the add control is disabled at the limit, counting the entries a change needs.
- **U-11, X12, S-2.** Render `TIER_SOURCES` and `MONEY_SOURCES`; use `tierBaselineLabel`.
- **X4, S-3.** `owedAt` keeps `finance-score`'s signature; `funding-ui` calls it that way.
