# /lesscars v1.1: freeway removal and freeway land

Amends `docs/superpowers/specs/2026-11-01-lesscars-design.md` (the v1 spec) and
`docs/lesscars/plan-v1.md` (the v1 plan). Everything the v1 spec says still holds unless this
document changes it.

## Why

The owner looked at the first live build and saw three problems:

- **Land under a freeway is counted as buildable while the freeway stands.** The four parcels under
  the Central Freeway stub (`3502112`, `3503002`, `3513071`, `3513074`: zoned P, land use VACANT,
  0 homes, 8,551 m² in all) already get an envelope in the no-plan baseline, worth up to about 480
  homes. Nobody builds homes under a freeway viaduct. Removing the stub therefore adds nothing in
  the model, when in reality it is the removal that frees the land.
- **The removed freeway still shows on the map.** After the stub comes down, the basemap keeps
  drawing it, with its labels and shields.
- **v1 frees far too little.** Freeways in SF are lined with green strips that are only frontage
  for the freeway. In the owner's words: "we should assume 'green space' that is merely frontage
  for highways is fair game at the usual large parcel rules."

The owner's decisions on where freeways end:

- **US-101 is cut at the Southern Embarcadero Freeway**: the Alemany interchange with I-280, near
  Alemany Blvd, Industrial St and Bayshore Blvd. Everything north of it comes down: the Bayshore
  Freeway, the James Lick Freeway, the Hairball at Cesar Chavez, the US-101/I-80 interchange, and
  the Central Freeway (the v1 stub becomes the north end of this removal).
- **I-80 is cut around Rincon Hill.** The Bay Bridge touches down at Rincon Hill and ends there.
  The elevated I-80 west of that point, over SoMa to the US-101 interchange, comes down.
- **I-280 stays**, including the Southern Embarcadero Freeway and the stretch north to King St.
- **The recovered green land in the messy interchanges hosts the large garages**: at least some of
  the Alemany interchange land and some of the Rincon Hill interchange land. This reverses v1 open
  question 8 ("garages off freed land") for these two garages only.

## Goals

1. Freeway land is unbuildable while its freeway stands, and becomes freed land when it comes down.
2. The removed freeways disappear from the map on the day their removal finishes.
3. The plan removes US-101 north of the Alemany interchange and I-80 west of Rincon Hill, and frees
   the land along both.
4. Two new edge garages sit on recovered interchange land, at Alemany and at Rincon Hill, and open
   before the closures they serve.
5. A new dataset is built, checked, uploaded and promoted, with the new headline and breakdown
   recorded.

## Non-goals

- Traffic modelling. The simulator has no traffic model and v1.1 adds none. Where 101 traffic goes
  (onto I-280, onto city streets) is not modelled; the plan text says so.
- The car shuttle (still v2).
- Removing I-280, or US-101 south of the Alemany interchange.
- Pricing, ownership or the politics of Caltrans land. No source has owner data; the model treats
  freeway land as available once the freeway is gone.

## Anti-goals

- **Demolishing homes.** Freeway land that holds homes is never freed. The v1 rule stands.
- **Freeing real parks.** A green strip that is a park people use (named open space, a playground,
  a community garden) is not freeway frontage. Freeing McLaren Park's edge because it is near
  I-280 would be wrong even if the geometry allows it.
- **Counting homes twice.** A parcel freed by the plan must not also count as baseline homes.

## Definitions

### Freeway land

A parcel is **freeway land** for a freeway segment when all of these hold:

- it has 0 homes today;
- its land use is VACANT, or its zoning is P with no building, or it is unparcelled right-of-way
  (already handled by the v1 carve);
- it lies under the freeway deck or ramps, or within the frontage band of the segment, and most of
  its area does;
- it is not a real park, school, rail yard or Port facility (the curated exclusion list below).

**The frontage band** is the land between the freeway and the nearest street or building line,
not a fixed distance. **My call:** start from parcels whose area is at least half within 60 m of
the freeway line, then curate by hand with a satellite or basemap check, the same way the v1
parking list was curated. The curated list is the source of truth, not the rule; the rule only
proposes candidates.

**Curated exclusion list.** Recon found parcels that may be real parks and must be checked, not
assumed: `3179011` and `3179010` near Balboa Park, `4012031`, and `4154001` (60,882 m² with a
baseline yield of 2,721, which looks wrong and needs explaining whichever way it goes). The
drafter records each decision with a reason.

### The owner's example

The strip beside US-101 between 18th and 22nd St, Potrero Ave to Vermont St, is 14 P/VACANT parcels,
about 7.5 ha. 12 of them get no envelope today. All 14 are candidates under this definition; the
drafter confirms each one.

## How freeway land behaves

### While the freeway stands (owner's decision: everywhere)

Freeway land is unbuildable in every simulator run while its freeway stands:
the /lesscars baseline, the /lesscars plan run before removal, and `/sim` and FZP. It is a
property of the land, not of the plan. Without it, `/sim` keeps counting homes under and beside
freeways that will not be built.

**Which freeways (my call): every freeway in SF that stands on a given day**, not only the ones
the plan removes. The reason for the rule (nobody builds homes under or in the frontage of a
freeway) holds for I-280 and southern US-101 as much as for the removed stretches. So freeway-land
lists exist for every freeway segment in SF: segments the plan removes free their land on the
removal day; the others (I-280, US-101 south of Alemany, the Bay Bridge approach east of the Rincon
Hill cut) never free it. If curating every segment by hand is too slow, the builder may accept the
rule's candidates for kept freeways after a spot check, and curate by hand only for removed
segments, where the land becomes homes.

This changes `/sim`'s and FZP's numbers. The build reports the change (homes removed from the
baseline, by freeway) before anything ships.

### When the freeway comes down

When a freeway segment's removal finishes, its freeway land becomes freed land:

- **Zoning** is the v1 freed-land rule (the larger of the adjacent zoning and SB 79 after the
  switch day).
- **The large-lot rule applies**, as it already does for freed sites: a site of 8,000 sq ft
  (743.2 m²) or more lifts to 65 ft (`LARGE_LOT_M2`, `LARGE_LOT_FLOOR_FT` in
  `pipeline/lib/local-program.ts`). This is the owner's "usual large parcel rules".
- **The initiative builds** on it with a scheduled build, as on all freed land, within the plan's
  housing capacity.
- **Freed P/VACANT parcels keep their parcel boundaries** where they exist, merged with any carved
  right-of-way piece they touch. Freed right-of-way is carved as in v1. **My call:** the builder
  decides how a parcel and an adjacent carved piece combine, as long as one piece of land is never
  counted twice.
- **The source label** in the breakdown stays "freed land". The page's freed-land disclosure says
  how much came from parcels and how much from right-of-way.

### Garages on freed land

The two new garages occupy part of their interchange's freed land. That part never gets homes.
The breakdown reports the homes the garage footprint costs (the v1 spec already requires this).

## The plan changes

These are the project changes to `plan-v1.md`. The drafter writes them up as a dated v1.1 section
of `plan-v1.md` (projects, Appendix A rows, parameter rows, schedule table), with the same evidence
rules as v1. The owner reviews that section before it is wired in.

### Freeway removals

- **`central-freeway-stub` is folded into the US-101 removal.** It stays the first phase, on its
  v1 schedule, so v1's dates and dependencies do not move.
- **US-101 north of Alemany** comes down in phases, north to south. **My call:** three phases,
  matching the named freeways: the US-101/I-80 interchange with what is left of the Central
  Freeway; the James Lick Freeway with the Hairball; and the Bayshore Freeway to the Alemany
  interchange. The drafter may split or merge phases where the data argues for it.
- **I-80 west of Rincon Hill**, from the Bay Bridge touchdown ramps to the US-101 interchange. One
  phase. Which Rincon Hill ramps stay, so the bridge still reaches city streets, is the drafter's
  call, written up with the reason.
- **Each phase** is a `highway-truncation` project with a line geometry (as the v1 stub uses),
  `rowHalfWidthM`, and the freeway-land parcel list for that phase.
- **Durations**: PV-hwy, 30 months per phase (tier 2, the Central Freeway), unless the drafter
  finds better evidence for a longer elevated structure.
- **Dependencies**: every phase depends on the garage that serves it. US-101 phases depend on
  `garage-alemany`; the I-80 phase depends on `garage-rincon`. Each phase also waits for the plan
  transit that carries the corridor's trips, chosen by the drafter (Fillmore sequencing, v1 spec).
  Phases may not overlap on the same freeway (**my call**: one demolition crew per freeway).

### Garages

- **`garage-alemany`** on recovered land in the Alemany interchange. Serves drivers from the
  Peninsula on US-101 and I-280.
- **`garage-rincon`** on recovered land in the Rincon Hill interchange. Serves drivers from the Bay
  Bridge.
- **`garage-south` (Division St, parcel `3901004`) is retired.** It sat at the US-101/I-80
  interchange, which v1.1 removes; its parcel returns to being an ordinary lot. **My call**,
  because a garage at a removed interchange serves nobody.
- **`garage-north`** (Lombard St) is unchanged.
- **A garage stands on freeway land before its freeway closes (my call).** The garage must open
  before the closure it serves, but its land is only freed when the freeway comes down. The
  unbuildable rule is about homes, so a garage is an allowed exception: a garage project may name
  `{ parcel }` sites that are freeway land not yet freed. The plan check accepts this only for
  garage projects. No ramp-closure projects are added. The drafter picks a footprint off the
  mainline deck (the loops and green between ramps) and says so. If no such footprint exists at one
  of the two sites, the garage goes on the nearest 0-home parcel instead, as in v1, and the
  write-up says why.
- **Spaces** by the v1 PV-spaces rule (footprint × 5 levels ÷ 30 m² per space).
- **Capacity**: the v1 `garage` capacity is 2. With three garages, the drafter staggers starts or
  raises the cap with a reason.

### Freeway land in the plan

Each removal phase lists its freeway-land parcels (by `blklot`) and its exclusions with reasons, in
the plan document and in `plan.json`. The pipeline check refuses a listed parcel that holds homes
(as v1 does for parking).

## The map

- **The removed freeway disappears from the basemap** on the day its phase's removal finishes: the
  freeway lines, casings, bridges, ramps (link layers), labels and shields from the protomaps
  basemap. Earlier days show it as today.
- **Check first (my call).** Basemap road features may lose their ids or merge into one line at
  low zooms. The first task confirms, by decoding `basemap.pmtiles`, that the removed stretches
  can be picked out by id at every zoom the page shows. If they cannot, the fallback is the tiles
  step: it moves the features of the removed stretches into their own source layer at build time,
  so the page filters that layer by day. The page must not keep drawing a removed freeway at any
  zoom.
- **Mechanism (my call):** a curated list of basemap feature ids per phase, committed with the
  plan, applied by a per-day filter on the basemap's highway, link, label and shield layers. The
  pipeline step that builds the list checks that every id exists in the dataset's
  `basemap.pmtiles`, so a basemap rebuild that renumbers features fails the build instead of
  silently drawing the freeway again.
- **The removed-line overlay** that /lesscars draws today (`features.ts`) stays, so the removal is
  still visible as a change, not just an absence.
- **Freeway land shows as freed land** on and after its freed day, with the same styling as v1's
  freed land.
- **Freeway land in `/sim`**: `/sim` and FZP show nothing new on the map; the land simply never
  builds.

## Data and build

- The freeway-land parcel lists and the basemap feature-id lists are enrichment files under
  `pipeline/enrichment/lesscars/`, produced by a pipeline command (like `lesscars-cnns`) and
  committed.
- A new dataset version, built, checked, uploaded and promoted through staging and production
  bump PRs, as in plan 3. The owner merges the release.
- `docs/dev/lesscars.md` records the new build's headline, breakdown and run time, and the change to `/sim`'s numbers.

## Evidence

- Central Freeway: demolition began March 2003; Octavia Boulevard opened 9 September 2005 (PV-hwy,
  tier 2).
- Freed-land homes on the Central Freeway parcels took 20+ years without a public builder (v1
  spec); the initiative builds instead.
- Frontage-band width, phase boundaries and garage spaces are tier 4 (invented) unless the drafter
  finds better.

## Owner decisions

1. **Freeway land is unbuildable everywhere while its freeway stands** (owner, 2026-11-03): in
   `/sim`, FZP and both /lesscars runs. The build reports the change to `/sim`'s numbers before
   anything ships.

## Rulings while planning (2026-11-03)

- **Phase geometry is a list of the freeway's street-segment ids (CNNs), not a drawn line.** With a
  drawn line the freeway's own centrelines stay "kept" and their 10 m strips erase most of the
  freed land (one reason v1's stub freed almost nothing).
- **`central-freeway-stub` depends on `garage-alemany`** in place of the retired `garage-south`;
  its other dependencies and dates are unchanged.
- **The large-lot lift applies only where it already does** (R-4 districts, per
  `pipeline/lib/local-program.ts`). Freed land elsewhere takes the v1 freed-land zoning without the
  lift. The v1.1 plan section says so.
- **Map:** basemap ids hold at every zoom, but at z11–13 US-101 is merged across the Alemany cut, so
  the tiles-step fallback (removed stretches moved to their own source layer) is the expected path.
