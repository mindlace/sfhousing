# Question conductor-5 — from incremental-game-conductor
## Question
Comprehension-gate finding gate-4: pools that never end still refill, and a closed pool is "at or near" empty (minor). Does the package stand as written on this point, or is it amended? If two specs disagree, which one states the system? If the finding sets the package against the owner's words, rule from the owner's words and their reasons as the ledger records them.
## What the package says
The finding below quotes the package with path and anchor; read those passages on disk.
## What I found
From a fresh reader who explained the system from the package alone and then compared that with the sources (`surveys/gate-explain.md`, `surveys/gate-findings.md`). The reader's claims are testimony, not verified by the conductor.

- **Sources.**
  - "Decision: public money ... Pools should be seen to drain as their money is allocated." (`IDR:490`)
  - "Each pool's bar ... starts full and drains as its money is allocated ... A pool that runs dry shows as empty from that month on." (`IDR:319-321`)
- **Package.**
  - "A pool with no end keeps today's reading, the free share of what it has received so far." (`D:208`)
  - "A pool's bar shows nothing special when the pool closes: by then its lifetime level is at or near empty" (`D:211`)
  - "Current funding" reads the lifetime level "only when every baseline pool ends" (`S/funding-measures#sec-design-level`). Today's baseline has OCOH, the General Fund, state and federal with no end, so that bar always refills.
  - Money returned to a closed pool raises its level (`S/funding-measures#sec-design-level`: "a lifetime level can rise"; `S/pool-closing#sec-design-closed`).
- **Drift.** The baseline bar, the one every player sees, still refills each year rather than draining. A dry pool can show as partly full. The window is 480 months, so a lifetime total over the window exists even for a pool with no end; the package chose not to use it.
## Options I see
- The package stands as written, and the ruling says why the source is met.
- The package is amended so the specs agree with each other and with the source.
## Blocking
No task yet: no operator has a plan. Units whose specs the finding touches: finite-funding, pool-closing, funding-measures.
