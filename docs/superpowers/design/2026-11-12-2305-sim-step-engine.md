# A step engine for the simulation: composition design

Status: **approved by the partner, 2026-11-13** ("i think this is in good enough shape for me, go ahead through the rest of the supercomposer sequence"). Section 5 holds every ruling. Section 5.3 lists the calls the orchestrator made after reading the rest of the engine; they were not put to the partner one by one. Section 8 is frozen: a change to an **M** row needs the partner. Sections 5.3, 8 and 9 were amended once more after the fidelity check (rulings T10 to T18), also under that go-ahead.

Ledger: `.superpowers/superconductor/sim-step-engine/ledger.md` (the request in the partner's words, the inventory, the surveys, every finding with its file and line, and the measurement).

Source model documents: the partner's request of 2026-11-12 (ledger, first entry); [the FZP timelapse design](2026-10-16-1903-fzp-timelapse.md) and its specs `2026-10-16-timelapse-sim-design.md`, `2026-10-16-stage-calibration-design.md`; `2026-10-28-sim-policy-levers-design.md`; `2026-10-31-sim-runs-design.md`; `2026-11-10-paired-draw-fix-design.md`; `2026-11-10-run-slider-design.md`; [the financing design](2026-11-09-1911-sim-financing.md) and `2026-11-09-finance-engine-design.md`, `2026-11-09-finance-score-design.md`.

## 1. Goal

Today the simulation computes one policy's whole future, 2026 to 2066, before it shows anything, and a policy cannot change once a run has begun. This package replaces that with a simulation that moves one month at a time.

- **The world at a month is a value.** Lots, projects, the funding line and the pools are rows in tables. One step turns the world at month t into the world at month t + 1.
- **Policy has dates.** A policy is in force between two dates and can change strength part-way. The step reads whatever is in force that month.
- **Many worlds, one step.** The variations are the same step applied to worlds that differ only in their draws.
- **The future fills in ahead of the viewer.** The worker computes months ahead of the playhead and the page shows how far it has got. Changing a policy throws away only what comes after the change.
- **The page claims a forecast, not a fact.** The headline is what happens by the end of the window on screen if nothing else changes.
- **Nothing in the model knows an end.** The simulation can always take another step. Forty years is how much the page shows and fills, not a property of the model (ruling R8).

The calibration, the data pipeline and the meaning of every existing lever stay as they are.

## 2. What the code and the measurements say

Each finding is in the ledger with its file and line (F1 to F11) or its measurement.

- **The model is already monthly.** A lot has a monthly chance of starting. A stage is a table of what has happened by each month in it, with a constant monthly rate after the table ends. The engine draws a project's whole life at once only because that is fast (F1).
- **A draw is a trait, not a date.** A lot's draw says how much accumulated chance it takes to start. A stage's two draws say how the stage ends and how long it takes at normal speed. The engine already turns a hazard that changes on known dates into a date by adding up month by month (F2), and a timer already multiplies only the time, never the outcome (F3). A step engine can keep the same draws and add up as it goes.
- **Without public money, lots do not interact.** Each lot's outcome depends on its own draws and on the pipeline projects that hold it (F4). Measured on the live city: the variance of the total is 0.96 of the sum of the per-entity variances.
- **With public money they compete.** One line and one set of pools serve every lot, in day order (F5, F9). Measured: lots become negatively correlated (0.65), and the band is about 10% narrower than independent lots would give. The default run has public money.
- **A lever change restarts everything.** The band and the shown run are discarded and begin again from 2026 (F6). The policy store is locked while a run plays, because the run holds one policy's future.
- **The band is a bell curve of dice.** On the live city the 2066 total has a skew of 0.03. The average plus or minus 1.28 standard deviations is within 3% of the band's width of the measured p10 and p90. About 50 worlds give that as accurately as 101 give ranked quantiles. The seeds vary the draws only: the band holds no doubt about the calibration, the market or the pools.
- **"The median run" does not exist before the end.** A run's rank at year 10 has a correlation of about 0.5 with its rank in 2066. The run nearest the median at year 10 ends in the middle fifth about as often as a random run.
- **A few sites carry the spread.** Ten entities hold 55 to 65% of the variance of the 2066 total: one very large lot and four pipeline projects.
- **The engine is not the slow part on live data.** One live run to 2066 takes about 8 ms with funding. What the page waits for after a lever change has not been measured on live data (lever recompute, the engine, building geometry and packing). Still owed.

From the spike (section 10), on the path without public money:

- **The month-step world gives exactly today's results.** 142,617 projects and 505 masters across the live and bench cities, 5 to 20 seeds each, with and without the market shift, with a later market step, with timers: none differ from `simulateDetailed` in route, any stage day, end, revision or existing homes.
- **A timer changed in mid-run moves days and nothing else.** Halving one stage's time from month 120, over 20 seeds: every event before month 120 identical; of 34,898 projects that ended in both runs none changed outcome; 8,403 moved earlier, none later.
- **Visiting every lot every month is too slow; visiting what is due is not.** Adding to every free lot's total each month costs about 110 ms a month for 48 worlds on the live city, twelve times the budget. Working out when each lot is next due and visiting only those costs 0.31 ms a month for 48 worlds (2.2 ms on the bench city). Both give the same results. Sharing one running total per lot across worlds did not help.
- **Almost every lot does nothing.** Per world, 158 to 466 of 139,804 lots ever get past their first attempt in forty years, and about 2,000 projects exist by the end. Storing every lot costs 10 MiB a world; storing only the lots that have left their starting state costs a few hundred kilobytes.

## 3. The model

These are the commitments. Section 8 types them.

### 3.1 The world

A world at month t holds:

- **Lots that have left their starting state.** Every lot begins free, on its first attempt, at risk since the dataset date. On the live city over 98% of lots are still in that state after forty years, and a world stores nothing for them: their draws are a function of the seed and the lot. For each other lot the world holds its attempt number, the day it became free, the projects holding it (how many, the last exit, whether it is blocked for good), whether its building has been demolished, and a start day that is already fixed but not yet reached.
- **Projects.** One row per project that is alive or has ended: its lot or lots, where it came from (pipeline or simulated), route, stage, the day it entered each stage, its *stage progress* (the current stage's drawn outcome, its drawn length at normal speed, how much of that length is used, and the speed in force), its size and its revisions, its kind, and what paid for it.
- **Applications.** The line of lots waiting for public money, in the order the line is served.
- **Pools.** For each pool: received, committed, spent, lent out, lost.

Static tables sit beside it and never change during a run: the lots' features, the pipeline projects as of the dataset date, the calibration, the pools and programmes as defined.

A world is a set of typed columns. It can be copied, sent between threads and compared. On the live city it is a few hundred kilobytes.

Beside each world sits a **due list**: for each month ahead, the lots and projects that will do something that month if the policy in force stays as it is. It is worked out from the world and the policy, and worked out again for whatever a policy change touches. It is not state: it cannot change what happens, only where the step looks.

### 3.2 Draws

Draws stay as they are: `draw(seed, entity, attempt, purpose, stage)`, a pure function. The world stores no generator. Nothing is drawn per step.

- **Starts.** Each month a free lot is at risk adds `-log(1 - h)` to a running total, h being that month's chance of starting. The lot's threshold for attempt k is `-log(1 - u)`, u its `INIT` draw. The lot starts in the first month whose total passes the threshold. A lot's months are counted from the day it became free, 30.436875 days each, and each month takes the odds in force on its first day. The day inside the month comes from a second draw (`INIT_DAY`). All of this is today's rule.
- This is the same as rolling against h every month. For a lot that has not started, the chance that it starts this month is exactly h, whatever h was in earlier months and however long the lot has waited. The running total is how one draw is turned into that sequence of monthly rolls; it does not make a lot that has waited "due". (Today's engine does this already: `piecewiseMonth`, ledger F2.)
- **Stages.** On entering a stage, a project's outcome and its length at normal speed come from its `STAGE` and `STAGE_TIME` draws, on the calibration in force that month. A pipeline project already in a stage at the dataset date has its length drawn given the time it has already spent there. While the speed s does not change, the stage ends on `entered + floor(s × length)`. When the speed changes on day c, the length used so far is carried over and the rest runs at the new speed: `used += (c - anchor) / s_old`, then the end is `c + floor(s_new × (length - used))`.
- **Starts with public money.** A free lot's attempt has three running totals, not one, and they share the attempt's draws (today's rule, `funded.ts:266-311, 772-872`). The *ordinary* total is the one above. The *market* total uses the same `INIT` draw against the lower of the ordinary rate and the rate shifted by the money on offer to a lot of its drawn size, so it never passes later than the ordinary one. The *affordable* total uses its own draw (`INIT_AFFORDABLE`) against the affordable rate. The size is one draw (`SIZE`) read in the zoning in force. When the market or the affordable total passes its threshold in a month where some programme reaches the lot, the lot applies for money that month; it keeps waiting in the line until it is awarded, its ordinary start comes, or it lapses.
- Because the running total and the stage's end follow from the policies that have been in force, the engine does not add anything up month by month and stores no total for a lot. It works out the month a lot or a project is next due from the policy of the months already past and the policy in force now continuing, and works it out again when the policy changes.

This is why a later policy change cannot flip what has already been decided, and why two worlds with the same seed and different policy stay comparable.

### 3.3 The step

`step` advances a world by one month under the policy in force that month. A month is 30.436875 days counted from the dataset date: month m covers days `asOf + floor((m - 1) × 30.436875) + 1` to `asOf + floor(m × 30.436875)`. The step visits only the lots and projects on that month's due list. Its systems run in this order:

1. **Policy.** If the policy in force differs from last month's: re-resolve rates and limits, work out again when each lot and project the change touches is next due, and re-make every waiting application under the new rules (today's re-pricing and lapse).
2. **Money in.** Pool inflows dated this month.
3. **Stages.** Projects whose stage ends this month leave it: they advance, complete or drop out. Entering a stage may revise the size. Dropping out frees the lot. Each event moves money (spend on entering construction, repay on completion, release or loss on dropping out).
4. **Starts.** Free lots whose market or affordable total passes its threshold this month join the line, in key order. Free lots whose ordinary start day falls this month are due to start.
5. **The line.** Serve the line once, in its order (the month applied, then the key), against the pools as they now stand. An award starts the project and removes the lot's other application. Money that moves after the line has been served (an awarded project that spends or releases in the same month) is seen by next month's serving.
6. **Ordinary starts.** Lots due to start that were not awarded start.
7. **Shadow starts.** A lot whose funded start pre-empted an ordinary start that would have fallen this month reports the homes that start would have added (`displaced`).

A chain inside one month is followed to its end in that step: a project that enters a stage and leaves it the same month, or a lot that is freed and starts again.

The step writes no totals. Everything it does leaves as an event with its day (section 8, S7), and readers count events. The page's series stay on calendar months, as today (`score.ts:25-49`): an event counts in the calendar month its day falls in, and a calendar month is final once every world has stepped through the model month that holds its last day.

An event keeps its day. Days are for the map, the cards and the calendar-month series. They do not order anything between entities: within a month, the order is the order of the systems and, inside a system, a fixed key (the line's key, then the lot's rank).

### 3.4 Policy with dates

A policy says **when** (one or more spans of months, each with its own settings), **where** (which lots, projects or pools it reaches) and **what** (the effect).

| Kind | Where | What | A project keeps |
| --- | --- | --- | --- |
| Zoning (rules, paint, protections) | lots, by a rule or by strokes | story limit, or not redevelopable | the zoning of the month it started |
| Permitting time | projects, by route and stage; `new` reaches projects that have not yet filed when the span begins (later starts, and pipeline projects still before filing), `all` reaches every project from then on | the speed at which a stage's length is used up | nothing: a change of speed takes effect the day it begins |
| Routes | new projects | the shares of each route | the route drawn when it started |
| Public money | pools and programmes | inflows, offers, terms | its award |

Policy dates are month starts. Nothing can start before the dataset date.

Switches a person turns on (protect rent-controlled buildings, the SB 423 clock, a scale on today's City funding) are policies of the same shape with their settings filled in. Their *where* and *what* are stored as settings, not as a flag, so a later editor can open them. What holds with no policy at all (the plan as adopted, permitting times as observed, City funding as it is today) is not in the document; the page draws it as three fixed rows.

### 3.5 Where today's rules read the future

One principle replaces each of them: **where a rule needs a future date, it uses the date implied by the policy in force that month continuing unchanged.** This is ruling R1 applied inside the model.

| Today | In the step engine |
| --- | --- |
| The line's second key is the month the lot would have started without money, searched as far as 2066 | The month its ordinary clock would pass its threshold at this month's rate, fixed when it applies |
| "Displaced" counts the ordinary start a funded start pre-empted, if it fell by 2066 | The pre-empted threshold stays as a shadow; the homes are counted in the month the shadow clock passes it |
| An award books every later money event of the project | Each money event is made when the project's stage event happens |
| The representative run and the best-to-worst ranks need every run's 2066 total | Dropped (section 3.6) |
| Money owed after 2066, added borrowing, limit statements | Each becomes a quantity as of a month: what is owed, what has been borrowed and which limit binds, at that month. The page reads them at the end of the window |
| "Skip lots that cannot start by 2066" | Gone as a rule. An engine may skip work only where that cannot change any later month |
| Pool inflows are laid out to 2066 when a run begins | Each month's inflows are made in that month's step |
| A project not ended by 2066 is "open" | A project is alive until it ends. "Open" is only what a reader sees at the month it stops reading |

### 3.6 Worlds, the band and the map

- **The ensemble.** W worlds with seeds 1..W advance in step under the same policy. A month's statistics are final as soon as every world has reached it.
- **The band** is the average plus or minus 1.2816 standard deviations across the worlds, per month.
- **The comparison.** "What the plan adds" needs a second ensemble on the same seeds under the comparison policy (today: the Family Zoning Plan as adopted, or the zoning before it). It advances in step with the first.
- **The map** follows one world, world 1, labelled as one possible city. There is no control to show another (ruling R6): a different city comes from a different simulation. No world is called the median. The seeds are the same in every simulation, so two simulations differ only by their policies.

What the page takes from the ensemble (OD-14):

- The headline and the centre of the chart are the average across the worlds. They describe the policy, not one city. The headline counts, as today, the homes actually completed since the housing-target period began plus the average of the simulated net completions, read at the last whole calendar month of the window.
- The band sits around that average. It does not follow the world on the map.
- The chart also draws the map's world as its own line, "this city", which wanders inside the band and sometimes outside it. Measured on the live city: the spread across worlds is about 6.5% of the total after forty years and about 30% after five.
- At the playhead the page gives both: this city's count, and the typical count with its range.
- "What the plan adds" is the average over the worlds of each world's difference from its twin under the comparison policy.

### 3.7 The buffer

The runner advances every world from the dataset date, ahead of the playhead, in slices that never block the worker for more than 50 ms. It fills a **window**: a start month and a length, forty years by default, beginning at the dataset date. The window belongs to the runner and the page. The world and the step take no end date and hold nothing computed out to one. The page shows how far the window is filled.

A policy edit has a date: the earliest month whose policy in force changed. Everything before that month is unchanged, because the draws and the earlier policy are the same. The runner resumes from that month and fills in again. There is no lock, no "edit policy" mode and no restart.

- An edit dated before the filled-to month discards every filled month from the edit's date on, however far the playhead has been. An edit dated after the filled-to month discards nothing.
- An edit pauses playback, and playback stays paused until the refill has filled the whole window (OD-13). The playhead does not move. If it is past the edit's date, the map and the results under it are stale until the refill passes it, and the page marks them so.
- The runner resumes from a kept copy of each world (one every five simulated years) and replays quietly from there to the edit (S16). The replayed months are unchanged and stay on screen.

## 4. Approaches

How a step treats chance and order. **The partner picked approach 2 (ruling R5).**

1. **Fresh dice every month.** Every lot and project rolls again each step against that month's odds. The odds, and so the statistics, are the same as in approach 2. Paired comparison survives only if every roll is keyed to its lot and its month (and, for a stage, to the month in the stage, not the calendar month); with an ordinary stream of random numbers a lever's effect drowns in noise. The cost is one draw per lot, per world, per month, and no world can share work with another. It cannot be checked project by project against today's engine, which draws once per lot.
2. **Fixed traits and clocks; the month is the unit of interaction.** Section 3 as written. Without public money it gives the same projects on the same days as today's engine for the same seed, while policy does not change. With public money, which of two applications in the same month is served first can differ from today, because today's line runs day by day.
3. **Fixed traits and clocks; interactions in day order.** The same world and the same step interface, but inside a month events run in day order as the funded pass does now. It reproduces today's funded results exactly. The inside of a step is an event queue, and today's day-level rules (same-day re-serving, re-pricing days) carry over as they are.

Why 2: the month is the grain of the calibration, and it is the form the request describes. The cost is that funded results are checked against today's by their statistics and by the ledger identities, not project by project.

## 5. Rulings and open decisions

### Ruled by the partner (2026-11-12)

| Id | Ruling |
| --- | --- |
| R1 | The page's claim is the forecast under current policy. The buffer always runs on to the end of the window (amended by R8; it said 2066). |
| R2 | The timeline shows one row per kind of policy, and each kind expands to show its policies. |
| R3 | A track opens its editor. Later, people will open built-in switches and change what they assume ("no rent controlled" assumes the existing rent control law). That comes later; the base design must leave room for it. |
| R4 | Look at how video and audio sequencing tools show complex sequences before settling the timeline. |
| R5 | "fix traits and clocks with monthly interactions": approach 2 of section 4. |
| R6 | "i don't care about 'show another possible city' - the way to get another possible city is to make a 'new sim' and pick different policies or whatever." The map follows one world; there is no control to switch worlds. The run slider goes. |
| R7 | The timeline's look is accepted (mockup 3). A closed kind shows a miniature of its policies; opening it turns the miniature into the full rows in place, with the kind row left as a heading. The miniature is not shown again above the open rows. |
| R8 | "Definitely want to drop the idea that 2066 is the end; it should be open-ended in construction, windowed to 40 years." The model has no end date. Forty years is the window the page shows and the runner fills. |
| R9 | "Yes, the window is fixed for the purposes of this redesign." The window starts at the dataset date, is forty years long and does not move in this package. |

### Ruled by the partner (2026-11-13)

The proposals below were accepted, OD-12 and OD-13 with the partner's amendments. They keep their ids. Nothing in this section is waiting.

| Id | Ruling |
| --- | --- |
| OD-3 | 48 worlds. The band is the average plus or minus 1.28 standard deviations. |
| OD-4 | Every simulation uses the same seeds, so two simulations differ only by policy. |
| OD-6 | "What the plan adds" is kept, against the same two comparisons as today. Later it becomes "mute these tracks". |
| OD-7 | `/lesscars` stays on the old engine, which stays in the tree untouched, until a later cut-over. |
| OD-8 | Policy dates are month starts only; nothing before the dataset date. |
| OD-9 | Any edit takes effect from its own date and the forecast is refilled from there. The lock and the setup and run phases go. |
| OD-10 | A schema 3 document opens as a schema 4 one with every policy in force from the dataset date, in memory, as schema 2 opens today. |
| OD-11 | "The world" (market conditions) is shown read-only on the timeline; opening it is later work with R3. |
| OD-12 | The page says the range is chance only and that a few large sites carry most of it, but not as standing text. "we've got to find a way to do more progressive disclosure; the amount of verbiage on the existing UI is excessive without some kind of interest signal (hovering, tapping, etc)". This becomes a global constraint (section 9). |
| OD-2 | The acceptance test for the rebuild is agreement with the engine in the tree, given the same dataset, policy and seed. Without public money: the same projects on the same days, seed for seed, while policy does not change. With public money: the same totals within a stated tolerance, and every ledger identity, because the line is served once a month instead of day by day (R5). Calibration and pipeline untouched. |
| OD-5 | "show the forecast". Months already filled are drawn ahead of the playhead, marked as forecast under current policy. The map shows the city at the playhead. The high-water mark goes. |
| OD-13 | "let's start from edit actions pause playback until refill fills the window". An edit pauses playback. The playhead stays where it is. Playback can resume once the refill has filled the whole window. A finer rule (resume once the refill passes the playhead) is later work. |
| OD-14 | The headline and the chart's centre are the average across worlds, with the band around it. The map's world is drawn as its own line, "this city". At the playhead the page gives both numbers. |

### 5.3 Calls made by the orchestrator after reading the rest of the engine (2026-11-13)

Each resolves a tension between this document and the code, or between two parts of this document. They are decomposition choices unless marked **model**; the partner approved the document before they were written and can strike any of them.

| Id | Tension | Call |
| --- | --- | --- |
| T1 | The first cut had the step write a monthly tally by model month. The page's series are by calendar month (`score.ts:25-49`), and model months end mid-month. | The step writes events only. `world-score` files them by calendar month, exactly as `shownSeries` does, so a world's series can be checked against today's to the unit. The tally row is gone from the step. |
| T2 | Section 3 spoke of one start clock. With public money an attempt has three (`funded.ts:266-311`). | Section 3.2 now says so. The market and affordable totals belong to `world-funding`; `world-core` owns the ordinary one and the hook the others plug into. |
| T3 | **Model.** Today an application made on a later day of the month than the lot's ordinary start never happens: the ordinary start wins. Served once a month, the application is made and can be awarded first. | Kept as the month-step rule (R5): inside a month the order is applications, the line, then ordinary starts, which is today's order inside a day (`funded.ts:1823-1904`). It can only move a start from ordinary to funded within one month. `world-funding`'s referee test measures the effect; a miss is reported, not tuned away. |
| T4 | "The same totals within a stated tolerance" (OD-2) had no number. | Section 9 states it. |
| T5 | Custom painting is ordered (a later brush wins, an erase removes only earlier paint; `policy.ts:510-527`). Dated policies need a rule for how painted policies combine. | **Model, small.** One painted policy holds one ordered list of brushes and behaves as today inside itself. Between painted policies in force, the one lower in the list wins on a lot both name; an erase never reaches another policy's paint. A schema 3 document's whole `custom` list becomes one painted policy. |
| T6 | Schema 3 keeps a saved timing set beside the current one (`timing.saved`). | It opens as a second permitting policy that is switched off. |
| T7 | The frame the step reads needs each zoning state's lot table and rates, which take time to build (the lever recompute). | `policy-timeline` compiles a document into its frames before the step sees them, in slices, and reuses a compiled zoning state whenever the lots it names are the same. The step never waits on a compile. |
| T8 | New code that lands in a folder hashed into the dataset version forces a dataset build and upload. The worker host (`scenario-host.ts`) is in such a folder, and it keeps the loaded dataset, the geometry and the brush handlers to itself. | All new code lives outside those folders (`src/lib/sim/world/`, `src/lib/timeline/`). Release A changes no hashed file. Release B may change `scenario-host.ts`, and only it, and only to let the new host use what it already loads (or to move it out of the hashed folder); the old engine's results must not change, and that branch follows the dataset-change procedure once. Section 9 says so. |
| T9 | The due list was said to belong to the world but is not state. | `step` takes it as its own argument, and `planDue` rebuilds it from a world and the timeline. A copied world needs no copied due list. |
| T10 | A free lot keeps the chance it has built up when the policy changes, but a lot that has never been touched has no row to keep it in (found by the fidelity check). | Nothing is stored. The step and `planDue` are handed the timeline and may read its months up to the one being stepped, so a lot's total is worked out from the frames it has already lived through. The past is known; only the future is not. |
| T11 | Pool and programme positions change when a money policy is added or removed, and kept worlds are resumed after such an edit. | A world names pools and programmes by id between steps. Money arriving in a month is a list on the frame (`arrivals`), left out of the frame's identity, and a frame's identity covers only the programmes on offer that month and the pools they draw on. So raising an inflow in 2040, or adding a fund that opens in 2040, refills from 2040 and not from the start. |
| T12 | The comparison for the default document is the zoning before the plan, which no document can say. | `comparisonOf` returns a document and the base it is compiled on. A document counts as default when no policy is in force in any month, so a policy that is switched off changes nothing. |
| T13 | The map hides an existing building only from a list sent once, when a run is first installed; a stream learns of demolitions later. | `map-stream` may change the map's timeline controller in one way: demolitions can be added after the first install, and taken back after an edit. |
| T14 | Zoned-capacity figures and the height overlays show one city; with dated zoning there are many. | Capacity is that of the last month of the window. The overlays and lot lookups show the zoning in force in the month the playhead is in. |
| T16 | The old engine is hashed into the dataset version; the new one is not, so a later change to it changes `/sim` for an unchanged dataset. | Deliberate. The old engine is hashed because `/lesscars` runs it when the dataset is built; the new engine runs only in the browser until `/lesscars` moves to it (out of scope), and joins the hash then. Until then `/sim`'s numbers are pinned by the referee tests against the old engine. |
| T17 | An award made in a month could be dated before the money that paid for it arrived that month, so the money series could show a pool below zero in a calendar month. | An award is dated no earlier than the latest money that reached a pool it draws on that month (`world-funding`). |
| T18 | Kept copies every 12 months for 96 worlds could pass a gigabyte. | Copies every 60 months, a 300 MB bound, and the runner measures it first (S16). |
| T15 | Baseline funding scales carry their own calendar dates, which are not month starts. | They stay inside one policy's settings, as a programme's own dates do, and are not turned into spans. |

## 6. Subsystems

Each becomes one spec.

Every subsystem's code lives under `src/lib/sim/world/` (engine side) or `src/lib/timeline/` (page side). The spike's code is kept for reference at `.superpowers/superconductor/sim-step-engine/spike/` and the accepted mockups at `.superpowers/superconductor/sim-step-engine/mockups/`.

- **`world-core`.** The world's tables, the draws, the clocks, the step and its system order, and every rule that needs no money: pipeline rows conditioned on the time they have already spent in a stage, multi-phase masters and phases, starts, sizes, stages, revisions, holds on lots. Its test is the old engine: seed for seed, the same projects on the same days under a policy that does not change. Lives in a new folder, `src/lib/sim/world/`, so the old engine and the dataset version are untouched.
- **`world-funding`.** Applications, the line and its key, the award rule, pool state and money events, re-making and lapse when the policy changes, the shadow start. It reuses the pricing functions in `src/lib/sim/finance/` and the award rule in `funding.ts` unchanged. Its tests are the ledger identities after every event and agreement with the old engine's statistics (section 9). Its first task measures the cost of a funded month.
- **`policy-timeline`.** The schema 4 policy document (kinds, policies, spans, settings), loading schema 3, and compiling a document into what the step reads each month: the zoning in force, the stage speeds, the routes, the money. It owns the rule for the comparison ensemble. It reuses envelope resolution and the lot recompute, and owns saving and sharing of the schema 4 document through the existing `/s` routes. Its first task measures, on the live city, how long compiling one zoning change takes.
- **`ensemble-runner`.** Worlds advancing in step, the comparison ensemble, slicing, resuming from an edit's date, the observation store, the band, and the worker messages that replace `initScenario`, `setLevers`, `reroll`, `timeline` and `ranks`.
- **`world-score`.** From observations to what the page shows: the series, the band, tiers, money, targets, the forecast at the end of the window; the project card from the world.
- **`map-stream`.** Building geometry and packed cells made as projects appear in the shown world, stage days filled in as they happen, and what is withdrawn when an edit throws the future away.
- **`timeline-ui`.** The timeline: the ruler, the playhead, the filled-forecast mark, a row per kind that expands, policies as bars with spans, selection opening the policy's editor, and the phone layout. It replaces the scrubber, the policy lock, the run phases and the run slider.

Later, outside this package: moving `/lesscars` onto the step engine and deleting the old one; opening built-in switches (R3); futures for the market (financing ruling R7).

## 7. Dependency order

1. `world-core` and `policy-timeline` (they meet at the monthly policy frame, section 8, rows S4 to S6).
2. `world-funding` (needs `world-core`).
3. `ensemble-runner` (needs 1 and 2), then `world-score` and `map-stream` beside each other.
4. `timeline-ui` (needs `policy-timeline`, `ensemble-runner`, `world-score`, `map-stream`).

Releases: A is 1 and 2, with nothing a user can see and the old engine as referee. B is 3 and 4, and switches `/sim` over. `/s` links keep working through B.

## 8. Interface table (frozen 2026-11-13, amended after the fidelity check)

Marks: **M** a model commitment (changes need the partner), **D** a decomposition choice (the orchestrator's). Each spec repeats its rows word for word. Types named but not spelled out here are today's, imported unchanged: `Schedule`, `Master` (`scenario/simulate.ts`), `LedgerEvent`, `Calibration`, `StageScale`, `ScenarioParcels`, `Precompute`, `InFlightProject`, `Pool`, `Programme`, `ResolvedTerms`, `ProjectKind` (`timelapse/types.ts`), `ProjectCard`, `Stage`, `Pathway`, `Day`, `ParcelId`, `TierUnits`, `TimedPackedCell`, `TimelineUpdate`, `Manifest`, `LeverCapacity`, `Lookups`, `LeverLookups`, `ParcelSummary`, `BrushQuery`, `LayerCtx`, `SimInput`.

| Id | Mark | Interface | Owner |
| --- | --- | --- | --- |
| S1 | M | `interface World { month: number; frame: number; lots: LotColumns; projects: ProjectColumns; line: LineColumns; pools: PoolColumns }`. Every column is a typed array or a plain array of numbers or strings; the world holds no functions, no generator and no reference to its inputs, so `structuredClone(world)` is a full copy. `month` is the last model month stepped (0 = the dataset date). `frame` is the `PolicyFrame.id` of that step. `lots` has rows only for lots that have left their starting state (section 3.1). `line` and `pools` are empty until `world-funding` fills them; between steps a world names a pool or a programme by its id, never by an index. | `world-core` |
| S2 | M | `function createWorld(statics: Statics, timeline: PolicyTimeline, seed: number, out: StepSink): World` makes the world at month 0 under `timeline.frameAt(1)` and sends the events already true at the dataset date. `function step(world: World, due: Due, statics: Statics, timeline: PolicyTimeline, seed: number, out: StepSink): void` advances `world` in place by one model month (to `world.month + 1`), running the systems of section 3.3 in that order over the entities due that month. Both are pure in their arguments and take no end date. `step` reads `timeline` only for months up to the one it is stepping: the past is known, the future is not. | `world-core` |
| S3 | M | `interface Statics { asOf: Day; parcelId: ParcelId[]; rank: Uint32Array; projects: InFlightProject[]; districtMaxStories: number \| null }`: what no policy can change. Row i of `parcelId` is row i of every `ZoningView`. `function staticsOf(input: SimInput): Statics` builds it from the loaded dataset. | `world-core` |
| S4 | M | `interface PolicyFrame { id: number; view: ZoningView; calibration: Calibration; newCalibration: Calibration; speed: StageScale; speedNew: { from: Day; scale: StageScale }[]; market: number; finance: FinanceFrame \| null }`: everything the step reads for one month. `interface ZoningView { parcels: ScenarioParcels; pre: Precompute }` is the lot table and start rates under the zoning in force. `calibration` serves rows in flight, masters and phases; `newCalibration` (route shares, the Local Program switch) serves a project at the moment its route is drawn. A project's time in a stage is scaled by `speed` times every `speedNew[i].scale` whose `from` is before the day the project filed (or which finds it not yet filed), the product clamped to `[MIN_SCALE, MAX_SCALE]` of `levers/timers.ts`. `market` is the shift in the log-odds of starting. `id` is the same for two frames, from any compile in one worker, exactly when their content is equal, `finance.arrivals` apart. | `policy-timeline` |
| S5 | M | `interface FinanceFrame { pools: Pool[]; programmes: Programme[]; offered: Uint8Array; slope: number; terms: ResolvedTerms; arrivals: { pool: number; day: Day; dollars: number }[] }`. `pools` and `programmes` list the same ids in the same order in every frame of one timeline, and an entry's definition is the one in force that month; `offered[g]` is 1 when programme g is in force on the first day of this month and its pool is not switched off that day. `arrivals` is the money reaching each pool on a day of this month, and month 1's list also holds what arrives on the dataset date itself; the step reads inflows from it and never from `pools[q].inflows`. | `policy-timeline` |
| S6 | M | `interface PolicyTimeline { frameAt(month: number): PolicyFrame; changes(): number[]; touched(month: number): Int32Array \| null; readyThrough(): number }`. `frameAt` is synchronous for 1 <= month <= `readyThrough()`. `changes()` lists, ascending, the months whose frame id differs from the month before. `touched(month)` gives, for a month in `changes()`, the lot rows whose row of the zoning view differs from the month before (empty when the zoning did not change; null when every lot may differ). `function firstDifference(a: PolicyTimeline, b: PolicyTimeline): number \| null` is the first month at which the two give frames with different ids or different `finance.arrivals`, or null. | `policy-timeline` |
| S7 | M | `interface StepSink { event(e: WorldEvent): void; ledger?(e: LedgerEvent): void }`. `type WorldEvent = { kind: 'start'; row: number; day: Day } \| { kind: 'enter'; row: number; day: Day; stage: Stage } \| { kind: 'revise'; row: number; day: Day; units: number; stories: number \| null } \| { kind: 'end'; row: number; day: Day; how: 'complete' \| 'exit' \| 'entitled' } \| { kind: 'phaseFiled'; row: number; day: Day; phase: number } \| { kind: 'award'; row: number; day: Day } \| { kind: 'displaced'; row: number; lot: number; day: Day; units: number }`. `row` indexes `world.projects` (masters have rows too) and never changes for a project. Events of one step arrive in the order the systems made them. `'start'` is sent once per row when it comes to exist, before any other event of that row; `'entitled'` ends a master; `'displaced'` names the funded project's row. `LedgerEvent` is today's (`money.ts`). | `world-core` |
| S8 | M | Readers of a world: `function scheduleAt(world: World, statics: Statics, row: number, day: Day): Schedule \| null` and `function masterAt(world: World, statics: Statics, row: number, day: Day): Master \| null` give the row as today's types, as a reader standing on `day` sees it (nothing dated after `day`; `end.kind` is `'open'` when it has not ended by then). One of the two is non-null for every row. | `world-core` |
| S9 | M | Draws: `draw(seed, entity, k, purpose, stageIdx)` and the purposes in `rng.ts`, imported unchanged. | `world-core` |
| S10 | M | Policy document schema 4: `interface SimPolicy4 { schema: 4; kinds: { zoning: Policy[]; permitting: Policy[]; money: Policy[] } }`, `interface Policy { id: string; label: string; preset: string \| null; on: boolean; where: Selector; spans: { from: Day; to: Day \| null; what: Effect }[] }`. `from` is the first day of a model month and `to` the last day of one (null = no end); spans of one policy do not overlap and are ascending. A policy that is `on: false` has no effect. `Selector` and `Effect` are tagged unions with one tag per lever that exists today; `policy-timeline`'s spec lists them. Order inside a kind's list is the order of the rows on the page and, for painted zoning and route shares, decides which wins. `function queriesOf4(doc: SimPolicy4): { key: string; query: BrushQuery }[]` lists the brush queries a document needs, keyed as today's `queryKey` keys them. | `policy-timeline` |
| S11 | D | `interface Due { take(month: number): Int32Array; put(entity: number, month: number): void; drop(entity: number): void }` and `function planDue(world: World, statics: Statics, timeline: PolicyTimeline, seed: number, through: number): Due`, which works out from scratch what is due in months `world.month + 1 .. through`, reading `timeline` for months up to `world.month + 1` only. An entity is a lot (its row in `Statics.parcelId`) or a project (`-1 - row`). `take` returns that month's entities in ascending order and forgets them. An entity due after `through` is planned when the runner extends the window. | `world-core` |
| S12 | D | The hook `world-funding` plugs into `world-core`: `interface FundingSystem { create(world: World, statics: Statics, frame: PolicyFrame): void; policyChanged(ctx: StepCtx): void; moneyIn(ctx: StepCtx): void; onProjectEvent(ctx: StepCtx, e: WorldEvent): void; apply(ctx: StepCtx, lots: Int32Array): void; serve(ctx: StepCtx): void; shadow(ctx: StepCtx): void; planLot(ctx: StepCtx, lot: number): number }`, called at systems 1, 2, 3, 4, 5 and 7 of section 3.3 and whenever the due list plans a free lot (`planLot` returns the first model month in which the lot will apply, or 0). `interface StepCtx { world: World; due: Due; statics: Statics; timeline: PolicyTimeline; frame: PolicyFrame; month: number; seed: number; out: StepSink; firstDay: Day; lastDay: Day; startProject(lot: number, day: Day, funded: FundedStart \| null): number; displace(row: number, lot: number, day: Day, units: number): void }`. `frame` is `timeline.frameAt(month)`. `displace` records the homes on the funded project's row and sends `'displaced'`. `world-core` exports `function withFunding(f: FundingSystem \| null): { createWorld: typeof createWorld; step: typeof step; planDue: typeof planDue }`; with null, and whenever `frame.finance` is null, no hook is called and the world is the unfunded one. `interface FundedStart { kind: ProjectKind; view: ZoningView; f: number; units: number; stories: number; applied: Day; programmes: string[]; granted: number; lent: number; guaranteed: number; certain: boolean; pathway: Pathway \| null }` (`pathway` null means the route is drawn as for any start). `world-funding` exports `function createFundingSystem(): FundingSystem`. | `world-core` |
| S13 | D | `function compileTimeline(doc: SimPolicy4, lots: Record<string, ParcelId[]>, ctx: CompileCtx, base: 'plan' \| 'preFzp'): TimelineCompile`, `interface TimelineCompile { step(budgetMs: number): boolean; progress(): { done: number; total: number; failedCells: string[] }; result(): PolicyTimeline; capacity(): LeverCapacity; unknownLots(): number; missingLots(): number }`. `missingLots()` counts the lots whose zoning changed and that have no yield record (they get a yield of 0, as today); the runner logs it as `leverStep` does today (`scenario-host.ts:966-970`; added 2026-11-13 by the conductor). `step` does at most about `budgetMs` of work and returns true when every frame is compiled; `result()` may be called once the first frame is ready and its `readyThrough()` grows as `step` is called. `capacity()` and `unknownLots()` are those of the frame in force in the last month of the window and are valid once `step` has returned true. `function comparisonOf(doc: SimPolicy4): { doc: SimPolicy4; base: 'plan' \| 'preFzp' }` gives what the comparison ensemble runs: for a document with no policy in force in any month, the same document on the zoning before the plan (`base: 'preFzp'`, today's `twinInput(…, 'preFzp')`); for any other, the default document on the plan (today's rule, `sim-page/policy.ts:571`, `levers/apply.ts:91-110`). `interface CompileCtx { input: SimInput; layers: LayerCtx; windowMonths: number; yields: YieldSource; now?: () => number }` is the worker's loaded dataset. `interface YieldSource { recompute(parcels: ScenarioParcels, needs: Needs): YieldRecompute; failedCells(): readonly string[] }` gives the compiler the lot yields a changed zoning needs, as today's `createTableRecompute` or `createYieldRecompute` (`levers/recompute.ts`) give them to `leverStep`; the host builds it from the gross table or the chunk records it already holds (amended 2026-11-13 by the conductor, decomposition choice). `now` is the clock that bounds a slice (default `performance.now`). `function lookupsAt(frame: PolicyFrame): LeverLookups` gives the stage tables the map's bars and the cards read for that frame, computed as today's `lookupsOf` computes them, with `speed` for rows in flight and `speed` times every `speedNew` for new projects. `function newScale(frame: PolicyFrame): StageScale` gives the scale a new project runs at in that frame. `function limitsAt(frame: PolicyFrame, row: number): FrameLimits` and `function limitsOf(frame: PolicyFrame, parcelId: ParcelId): FrameLimits \| null` give which policy sets a lot's story limit under the zoning in force in that frame, as today's `limitSources` and `ownerOf` do (`levers/source.ts`): `interface FrameLimits { owner: PolicyLimitOwner; protected: boolean }`, `type PolicyLimitOwner = { kind: 'fzp' } \| { kind: 'paint'; policy: string } \| { kind: 'rule'; ruleId: string; policy: string }`. The caller passes the frame object it got from `frameAt` of the timeline in use; attribution belongs to the compile, not to the frame's id (the three added 2026-11-13 by the conductor for the project card). `function cityInputAt(frame: PolicyFrame): FrameCityInput` with `interface FrameCityInput { readonly stories: Uint8Array; readonly countable: Uint8Array; readonly sources: LimitSources }` gives the city inputs the host needs for `heights` and `heightLids` under that frame's zoning (the unfilled envelope stories, the countable mask and the limit sources, as today's host builds them); keyed on the frame object like `limitsAt` (a frame no compile handed out throws); the arrays are shared and must not be mutated or transferred (added 2026-11-13 by the conductor). | `policy-timeline` |
| S14 | D | Worker messages, defined in a new `src/lib/sim/timeline-protocol.ts` with their own error codes (today's `ScenarioErrorCode` values plus `'timeline'`). New, to the worker: `{ type: 'openTimeline'; rev: number; manifest: Manifest; policy: SimPolicy4; lots: Record<string, ParcelId[]>; worlds: number; months: number }`, `{ type: 'setPolicy'; rev: number; policy: SimPolicy4; lots: Record<string, ParcelId[]> }`, `{ type: 'viewMonth'; month: number }` (the model month the playhead is in) and `{ type: 'resyncMap' }`. `lots` holds the lots of each brush query the document needs (`queriesOf4`), by query key, resolved by the page through today's `resolveBrush`. New, from the worker: `{ type: 'compiling'; rev: number; done: number; total: number; failedCells: string[] }`, `{ type: 'compiled'; rev: number; capacity: LeverCapacity; unknownLots: number; statics: ScoreStatics }`, `{ type: 'filled'; rev: number; through: number; series: SeriesChunk }` (`through` is the last final calendar-month index; `series.from` is the first index carried), `{ type: 'refill'; rev: number; from: number }` (every calendar month from index `from` on is withdrawn until filled again), `{ type: 'cells'; render: TimelineUpdate }` and `{ type: 'lookups'; month: number; lookups: LeverLookups }`. `rev` is the page's count of policy edits; the worker drops work for an older `rev`, and the client drops a `compiling` whose `rev` is older than the last `setPolicy` or `openTimeline` it sent (progress display only). The client delivers `compiled`, `filled` and `refill` in arrival order whatever their `rev`, dropping only those older than the last `openTimeline` it sent: a post at an older `rev` was valid when the worker made it, months before an edit are never posted again, and the worker's `refill` at the newer `rev` withdraws what the edit changes. A consumer applies these posts in order and does not assume `rev` rises from one message to the next; a `filled` chunk belongs to the statics of the last `compiled` delivered before it. `cells` and `lookups` carry no `rev` and are never dropped: the map's revision numbers are their own sequence. `resyncMap` is answered by a `cells` whose update is revision 0 with every cell and the whole demolish list. `lookups` is posted on open and whenever the last `viewMonth` moves into a frame whose permitting differs, as a new object each time; it is what the map's bars read. A document the compiler rejects is answered with `error` code `bad-request` at its `rev`, and the previous timeline keeps filling. These replace `initScenario`, `reroll`, `setLevers`, `timeline`, `ranks` and `levers` on `/sim`. Every other message of today's protocol (`parcelSummary`, `resolveBrush`, `brushCatalog`, `lotOutlines`, `previewBuildings`, `heightLids`, `lotAt`, `prefetch`, `retryChunks`, `ready`, `chunks`, `heights`, `error`) keeps its shape. `parcelSummary` is answered from world 1 as it stands on the requested day, and its `ParcelSummary` gains `lookups?: Lookups`, the stage tables of the frame in force that day for that project. `heights`, `heightLids`, `lotAt` and `previewBuildings` answer for the zoning in force in the last `viewMonth` received (month 1 before any); `heights` is posted again when that zoning changes. `openTimeline` is routed and checked as `initScenario` is today and, like it, disposes the editor host's state. | `ensemble-runner` |
| S15 | D | `interface SeriesChunk { from: number; mean: MonthRow[]; sd: MonthRow[]; shown: MonthRow[]; planEffect: { mean: PlanRow; sd: PlanRow }[]; money: MoneyRow[] \| null; tiers: TierUnits[] \| null }`: one entry per calendar month from index `from`. `MonthRow` has today's `TimelineScore['shown'][number]` fields; `shown` is world 1 ("this city"). `PlanRow` is `{ entitledNew: number; completedNetNew: number }`. `MoneyRow` is one month's entry of every series in today's `TimelineScore['money']`. `interface WorldSeries { add(e: WorldEvent, world: World, statics: Statics): void; stepped(month: number): void; finalThrough(): number; rows(from: number, through: number): MonthRow[]; data(): WorldSeriesData }`, one per world, which the runner feeds (`stepped` after each step, with the model month just stepped); `WorldSeriesData` is plain data that `structuredClone` copies. `function createWorldSeries(s: ScoreStatics, from?: WorldSeriesData): WorldSeries`. `function chunkOf(plan: WorldSeries[], twin: WorldSeries[], money: MoneyFeed \| null, from: number, through: number): SeriesChunk`. `interface MoneyFeed { ledger: LedgerEvent[]; finance: FinanceFrame; world: World; statics: Statics }` is world 1's. `function scoreStaticsOf(input: SimInput, timeline: PolicyTimeline, base: 'plan' \| 'preFzp', windowMonths: number, rhna: ProjectsFile['rhnaCompletedNet']): ScoreStatics` (`rhna` is the homes completed since the target period began, which the host reads from the loaded projects file and `SimInput` does not carry; added 2026-11-13 by the conductor), called once the plan timeline is fully compiled. `function viewOf(chunks: SeriesChunk[], statics: ScoreStatics): TimelineView` builds what the page reads. `function cardAt(world: World, statics: Statics, frame: PolicyFrame, deps: CardDeps, parcelId: ParcelId, day: Day, projectId?: string): { summary: ParcelSummary; lookups: Lookups \| null }`, which the runner calls to answer `parcelSummary` from world 1. | `world-score` |
| S16 | D | Resuming after an edit: the runner keeps a `structuredClone` of each world, and of each `WorldSeries`' `data()`, at the model months listed in one exported constant, `COPY_MONTHS`, which is `[0]` (amended 2026-11-13 by the conductor from "every 60th month": measured on the live city, copies every 60 months add 2,322 MB against 546 MB for month 0 alone, and denser copies save at most the quiet replay, about 1 s of a resume), resumes from the last copy at or before the month before the edit, steps quietly from there to the month before the edit (those months are unchanged and are not withdrawn or posted again), and rebuilds the due list with `planDue`. World 1's ledger is cut back to its length at that copy. No copy is thinned. The worker's heap, with both ensembles filled and every copy kept, stays under 300 MB over today's loaded dataset. (Measured 2026-11-13, funded, 96 worlds: 427 MB with no copy and 546 MB with the month-0 copy, so this bound is not met; the partner is to re-set it. Until then the runner's test reports the heap and asserts no figure.) | `ensemble-runner` |
| S17 | D | `interface MapStream { onEvent(e: WorldEvent, world: World, statics: Statics): void; flush(world: World, statics: Statics, budgetMs: number): TimelineUpdate \| null; rewind(world: World, statics: Statics): void; snapshot(world: World, statics: Statics): TimelineUpdate }` for world 1 only, made by `function createMapStream(deps: MapStreamDeps, windowMonths: number): MapStream`. `flush` returns today's `TimelineUpdate` (`map/types.ts`) holding, whole, every cell in which a project changed since the last flush, or null when nothing changed. `rewind` is called with world 1 as restored after an edit; the next flushes replace or remove every cell that differs. `snapshot` returns a revision 0 holding every cell and the whole demolish list, and restarts the revision count. After revision 0, `TimelineUpdate.demolish` carries the demolitions newly known, and a new optional field `restore?: ParcelId[]` names lots whose demolition no longer holds; `map-stream` changes the map's timeline controller to apply both (today it ignores `demolish` after revision 0). `MapStream` also has `cellsFor(cellIds: Iterable<string>): Set<string>`: the cells outside `cellIds` of every project the stream holds that is anchored in one of them, which the host adds to its chunk loader's wants (as `Geometry.cellsFor`); a pure query that packs nothing and takes no budget; the host calls it after each non-null `flush` and on a viewport change (added 2026-11-13 by the conductor). | `map-stream` |

## 9. Global constraints

- The calibration file, the dataset and the pipeline do not change. No file under the folders hashed into the dataset version (`pipeline`, `src/lib/data`, `src/lib/generator`, `src/lib/timelapse`, `src/lib/plan/{geometry,types}.ts`, `src/lib/sim/{scenario,levers,finance}`, `src/lib/scoreboard`) is added, changed or removed in Release A. In Release B the one exception is `src/lib/sim/scenario/scenario-host.ts`, which `ensemble-runner` may change or move so that the new host can use the dataset it loads, without changing any result of the old engine; that branch then follows "Finishing a branch that changes the dataset" in `docs/dev/pipeline.md`. New code imports from the hashed folders. A builder who finds any other change necessary stops and reports.
- The step and everything it calls may read the policy of the month being stepped and of earlier months, never of a later one.
- Agreement with today's engine (OD-2). Without public money and under one frame: for every seed tested, `scheduleAt` and `masterAt` over every row at the horizon day equal `simulateDetailed`'s schedules and masters, and each world's calendar-month series equals `shownSeries`. With public money, over seeds 1 to 200 on the bench city and on the live city with baseline funding, at years 5, 10, 20 and 40: the mean of completed net homes within 1% of today's mean, its standard deviation within 15% of today's, and the mean number of awards and of funded homes within 3%. The ledger identities hold after every step in every world. A miss is reported with its numbers; no rule is changed to meet it.
- `exp` and `log` only from `src/lib/timelapse/math.ts`. `Math.exp`, `Math.log`, `Math.pow`, `Math.log1p`, `Math.expm1` and the `**` operator are never used under `src/lib/sim/world/`, and the determinism ESLint rule's `files` gains `src/lib/sim/world/**` (`world-core` adds it; `eslint.config.js` is not hashed).
- The same inputs give the same world, in Node and in the browser.
- No slice of worker work longer than 50 ms.
- `step`, the world and every function they call take no horizon, read no end date and keep nothing laid out to one. Only the runner and the page hold the window.
- One month for every world of both ensembles, scoring included, on the live city: at most 9 ms on the reference machine. (Playback at its fastest covers 36 months a second; the forecast must fill at least three times faster.) The spike measured 0.31 ms for 48 worlds without public money; the funded path is unmeasured, and `world-funding` measures it first.
- No user setting may decide directly how much gets built (levers spec anti-goal, kept).
- A lever that changes only timing never changes any project's outcome, and moves its days in one direction (paired-draw fix, kept). This holds exactly without public money. With public money a timer can still change which applications are awarded and when, because releases and repayments fall on stage days; that is an effect of the money and is not to be "fixed".
- Tests that run in signoff assert behaviour and order, never wall-clock time. Every timing bar lives in `test:perf`.
- WCAG 2.2 AA for the timeline, including keyboard control of every bar.
- Explanation waits for interest (OD-12). At rest the page shows numbers, short labels and controls. Sentences that explain a number, a caveat or a method appear only when the reader points at, focuses or taps the thing they explain. What appears on pointing also appears on keyboard focus and on tap, stays while pointed at, and can be dismissed (WCAG 1.4.13). An explanation is itself short: it says what the reader cannot infer and stops (partner, 2026-11-13: "A forecast if nothing changes" is sufficiently unambiguous; "if you can infer it don't belabor it"). No new standing paragraph is added to `/sim`, and the specs for `timeline-ui` and `world-score` list each text they carry over from today's page with where it goes.

## 10. The spike

A throwaway build of sections 3.1 to 3.3 for the path without public money was run on 2026-11-12. Its results are in section 2; its code is thrown away. What it settled:

- The claim of section 4, approach 2, holds exactly without public money (OD-2's first half is achievable, and was achieved).
- The step visits what is due and does not add to every lot (sections 3.1 to 3.3 were rewritten to say so; S11).
- The sharper rules now in section 3.2: a lot's months count from the day it became free; the start day is its own draw; the stage's end is a whole number of days and has a stated rule for a change of speed; a pipeline project's current stage is drawn given the time already spent.
- Holds need more than "free or held": a lot is free only when every project holding it has dropped out, and is blocked for good if any holder completes, is skipped or is still alive. A master passes its holds to its phases at entitlement. `world-core`'s spec carries these as today's rules.
- Today's market has one step, at the dataset date, so the live city never exercises a change of odds part-way. The spike tested one with a made-up later step. The specs must test it too.

Still owed. Each is now the first task of a spec:

- The cost of the funded path as a step (the line, the pools, re-making applications): `world-funding`.
- Making a world for 48 seeds (the spike took 12 to 16 ms a world when it planned every lot; planning only lots due inside the window should be far less, unmeasured): `ensemble-runner`.
- Where the page's wait after a lever change goes today on live data: `policy-timeline` measures the compile of a zoning change; `map-stream` measures geometry and packing.

## 11. Traceability

Mechanisms that exist today, and where they go, read from the code. The clause-by-clause check against the fifteen source documents (1,055 extracted clauses) was done by two fresh-eyes reviewers; their reports, with every clause's class and every gap, are `.superpowers/superconductor/sim-step-engine/fidelity-engine.md` and `fidelity-page.md`, and the spec-set review is `fidelity-specs.md`. Every blocker and should-fix in the three was resolved in section 5.3, section 8, section 9 or the spec named in the finding; the ledger lists which.

| Mechanism today | Carried by |
| --- | --- |
| Counter draws; purposes; entity keys | S9, unchanged |
| Monthly start chance from lot features; market shift | 3.3 system 4; S4 `market` |
| Stage tables, tail, outcome and time drawn apart | 3.2; `sampleTransition` reused |
| Pipeline rows conditioned on time already in stage | `world-core` (initial stage clocks) |
| Timers scale time only; `new` and `all` | 3.4; S4 `speed`, `speedNew` |
| Route shares for new projects; Local Program lots streamlined | S4 `newCalibration`, `view` |
| Masters and phases; phase gap | `world-core` |
| Holds; demolished once | `world-core` |
| Reservations (`reservedFrom`) | Out of scope: only `/lesscars` sets them |
| Size draw; revisions on entering a stage | `world-core` |
| Dated zoning (regimes): a project keeps the zoning of its start month | 3.4 |
| Funded latent starts; min-rate rule; certain bundles | `world-funding`; 3.1 risk clocks per kind |
| Line key | 3.5, changed (second key) |
| Award rule; coverage level; tolerance | `world-funding`, reused |
| Serving in day order, re-serving on a release the same day | **Changed** by R5: once a month |
| Re-pricing days, lapse, new spells | 3.3 system 1 |
| Pool state, ledger events, identities E1 to E7 | `world-funding`; S7 `ledger` |
| Fully funded projects always advance, on `sampleAdvance`, with no revisions | `world-core` rule 15; the route for a certain affordable award in `world-funding` rule 11 |
| `displaced` | 3.5, changed |
| Net fast path equals the detailed run | Replaced: every world's events feed one `WorldSeries` (S15), checked against `shownSeries` |
| Band of 101 by nearest rank | **Changed** under OD-3 |
| Representative seed; ranks; run slider | **Dropped** by R6 |
| Plan effect against a twin on the same seeds | 3.6 |
| High-water mark | **Dropped** under OD-5 |
| Policy lock during a run | **Dropped** under OD-9 |
| `/lesscars` build-time runs and stored schedules | Out of scope (OD-7) |
| The engine is in the dataset version | **Changed** for the new engine until `/lesscars` moves (T16) |
| The two phases, the Run button and its autoplay; the URL seed | **Dropped** under OD-9, OD-4 (`timeline-ui` rules 24, 25) |
| Demolitions sent once, in revision 0 | **Changed** (T13; `map-stream` rule 8) |
| Displaced homes counted when the funded project completes | **Changed**: counted when the replaced start would have happened (3.5; `world-score` rule 2) |
| Inflows laid out to the end date; an inflow on the dataset date | Month by month on the frame; the dataset date's arrive with month 1 (S5) |
| "One possible future … not a forecast" | **Changed** wording under R1 (`timeline-ui` rule 38) |

## 12. Out of scope

- Any change to the calibration, the data, or what a lever means.
- Doubt about the calibration or the market in the band.
- Moving `/lesscars`; deleting the old engine.
- Editors for the assumptions inside built-in switches (R3); the design only leaves room.
- Running the step anywhere but the web worker.
- Reservations (`reservedFrom`) and the freed-land rules: only `/lesscars` sets them, and it stays on the old engine.
