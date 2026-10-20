# Large-site massing: design spec

Status: draft, 2026-10-19. Owner: typology generator (district step, §4.1–4.4), pipeline-massing (`generateForUnits` changes, §4.5), project-records (phase heights, §4.6), timelapse-sim (masters without phases, §4.7). Amends [typology-generator](2026-10-10-typology-generator-design.md), [pipeline-massing](2026-10-16-pipeline-massing-design.md), [project-records](2026-10-16-project-records-design.md) and [timelapse-sim](2026-10-16-timelapse-sim-design.md) where noted.

## 1. Intent

Large sites currently render as one flat, low building that fills the whole site. This happens on both the paint map (`/`) and the FZP timelapse (`/fzp`). Examples are Hunters Point Shipyard, Candlestick Point and Mission Rock. None of these projects looks like that in its published plans. They are districts: streets, blocks, open space, and many buildings of mid-rise height or taller. The flat slab looks bizarre, and it misrepresents what the plans propose.

There are three causes (investigated 2026-10-19):

1. **No subdivision.** The generator masses every site as one building: one coverage slab over 70–80% of the site, centred on it (`massing.ts:66` `baseFootprint`). It has no streets, blocks, open space, or cap on footprint or depth. On a 40-hectare site, that slab is one roof 500 m long.
2. **The lowest height that fits.** When a record has no stories, `generateForUnits` takes the fewest stories whose capacity reaches the unit count (pipeline-massing §4.4, case 2). On a huge site, one to three stories already hold thousands of units. Every DA phase takes this path, because phases carry `stories: null` (`engine.ts:715`).
3. **A 1 m sheet.** A multi-phase master with no phases is drawn as its largest parcel's outline extruded 1 m (`massing.ts:132`, `pack-timed.ts:19`). This applies to Pier 70, India Basin, Potrero Power Station, the HOPE SF sites and others.

The fix has three parts, all approved in principle by the partner on 2026-10-19:

- **(A) District massing.** Above an area threshold, split the site into blocks separated by streets, set some land aside as open space, divide blocks into building lots, and run the existing per-lot generator on each lot. This applies to paint and `/fzp` alike.
- **(B) Heights for DA phases.** Curate the planned heights in `multiphase.json`. When stories are unknown on a large site, start from a default height and only go up from there, never down.
- **(C) Mass masters without phases.** Mass them like any other phase, on their free DA parcels with their remaining units, instead of drawing the 1 m sheet.

## 2. Goals, non-goals, anti-goals

**Goals**

- A large site reads as a district: streets, blocks, gaps between buildings, plausible heights.
- The same district step serves `generate` (paint, T11 yields) and `generateForUnits` (pipeline and phases), so both modes look alike.
- Planned heights come from the DA documents (tier 1) wherever they exist, following the evidence hierarchy.
- Small and ordinary lots are byte-identical to today: same output, same goldens.

**Non-goals**

- Reproducing a project's real site plan: real street alignments, real block shapes, named parcels. Real footprints remain R10.
- Height zones within a district: towers here, townhouses there, as the DA design documents specify. §5 records this as a seam.
- Non-residential massing such as R&D, retail or schools. The model masses housing only. §4.3 explains how lots left unbuilt stand in for these uses.
- Changing the minimum-stories rule for ordinary lots (§4.5, my call).

**Anti-goals** (failure even if it technically works)

- A counted number changes for an ordinary lot.
- The district grid reads as noise: slivers, triangles, or lots too small to hold a building.
- A record's stated stories are overridden. A stated story count (tier 0) still wins.
- Districts break the map's frame budget or the 3 s reroll budget.

## 3. Constraints

The global constraints of the FZP timelapse design apply verbatim (pipeline-massing §3): evidence hierarchy, data quality, determinism, honesty of numbers, performance, "editor unchanged". In addition:

- **Determinism.** District output is a pure function of its inputs, transcendental-free (AC4), and independent of input order.
- **Dataset hash.** `src/lib/generator` is already in the dataset-version hash (T11). Districting a large parcel changes its T11 `yield` and `baseYield`, and with them the T4a `potentialRatio` feature. This change therefore produces a new `datasetVersion`, and stage-calibration refits on the new features. That is expected, not a regression.
- **Paint numbers change for large parcels.** Streets and open space take land, so a painted large parcel holds fewer units than today's single slab. Partner ruling, 2026-10-19: intended. Land used for things other than buildings is subtracted.

## 4. Behaviour

### 4.1 When a site is a district

A site is a **district** when the area of its domain (the assembled union for several parcels, or the single parcel's polygon), summed over **all** its pieces, is at least `DISTRICT_MIN_M2`. Today's `normaliseSite` keeps only the largest piece, so it cannot measure this sum. The district path therefore needs a variant that keeps every piece (`normaliseDistrict`, new in `site.ts`). Pieces are usually real blocks that real streets already separate.

Grid per piece (my call):

- A piece larger than one block (`BLOCK_U_M · BLOCK_V_M`) gets the street grid of §4.2.
- A piece of one block or smaller is used as a block as it is, with no synthetic street through it, and goes straight to the lot step (§4.2 step 4).

"Ordinary" in this spec means a site whose summed area is under `DISTRICT_MIN_M2`. A site whose pieces add up to 2 ha or more changes behaviour even if its largest piece is smaller. Such a site is several blocks, and today it masses only one of them.

- `DISTRICT_MIN_M2 = 20_000` m² (2 ha). This is about two typical SF blocks; a typical block is 1.0–1.3 ha net of streets (§4.8). Tier 2.
  - Measured on dataset `2026-10-19-547e741b` (153,509 eligible parcels): 170 eligible parcels are 2 ha or larger, holding 19.4% of eligible land.
  - All curated DA phases with credible densities (1–10 ha, about 120–400 units/ha) of 2 ha or more become districts. So do Mission Rock phases 2–4 (3.7 ha) and Potrero Power Station (5.0 ha).
  - Sites of one block or smaller, which are under 2 ha, stay on today's path.
- Below the threshold nothing changes. The site goes through today's `generate` and `generateForUnits` paths, byte-identical.

For an **assembled** multi-parcel site, districting applies to every component of the union, not just the largest. This differs from pipeline-massing §4.2 step 7 for non-districts, which masses only the largest component. A component smaller than `LOT_MIN_M2` is skipped.

### 4.2 Layout: streets, blocks, lots

The layout is computed once per site in local metres. It is deterministic, and its only randomness is the site's own seed draws. All lengths are constants in `constants.ts`, each labelled with its tier.

```
 site boundary ─────────────────────────────────────────┐
 │  ┌──────┬──────┐ ║ ┌──────┬──────┐ ║ ┌─────────────┐  │
 │  │ lot  │ lot  │ ║ │ lot  │ lot  │ ║ │             │  │
 │  ├──────┼──────┤ ║ ├──────┼──────┤ ║ │ open space  │  │   ═ / ║  street gap STREET_M
 │  │ lot  │ lot  │ ║ │ lot  │ lot  │ ║ │  (no lots)  │  │   block  pitch BLOCK_U_M × BLOCK_V_M
 │  └──────┴──────┘ ║ └──────┴──────┘ ║ └─────────────┘  │   lots   ≤ LOT_FRONTAGE_M along u,
 │ ═══════════════════════════════════════════════════  │          two deep across v
 │  ┌──────┬──────┐ ║ ┌──────┬──\                       │
 │  │ lot  │ lot  │ ║ │ lot  │   \  clipped edge block   │
 │  └──────┴──────┘ ║ └──────┴────\                     │
 └──────────────────────────────────────────────────────┘
        u (long principal axis) ──▶
```

1. **Grid.** Lay a rectangular grid aligned to the site's principal axes `u` and `v` (`Site.u`, `Site.v`). The pitch is `BLOCK_U_M + STREET_M` along `u` and `BLOCK_V_M + STREET_M` along `v`. The grid origin is the site centroid, offset by a seeded fraction of a pitch (`districtOffsetU`, `districtOffsetV` ∈ [0, 1), new variety draws). This keeps neighbouring districts from aligning in an artificial way.
2. **Blocks.** Each grid cell, shrunk by `STREET_M / 2` on every side, is intersected with the site domain (holes included). Each resulting piece is a block. A piece smaller than `BLOCK_MIN_M2`, or one failing the 1.5 m width test (`MIN_WIDTH_INSET_M`), is dropped and becomes unbuilt ground.
3. **Open space.** Blocks are ranked by a seeded hash of their grid index `(i, j)`. Blocks are set aside as open space in that order until the open-space area reaches `openSpaceShare · A_blocks`, where `A_blocks` is the total block area. Open-space blocks get no lots and no geometry. `openSpaceShare` is `OPEN_SPACE_SHARE` (tier 4) unless the caller passes a curated value (§4.6, tier 1). My call: whole blocks, not slivers, because a whole empty block reads as a park.
4. **Lots.**
   - Split each remaining block across `v` at its mid-line into two lots, back to back, when its `v` depth is at least `2 · LOT_DEPTH_MIN_M`. Otherwise it stays one deep.
   - Then cut each strip along `u` into `n = ceil(length_u / LOT_FRONTAGE_M)` equal lots.
   - A lot under `LOT_MIN_M2` merges into its neighbour along `u`.
   - Each lot is identified by its index `(i, j, side, k)`.
5. **Order.** Lots are ordered by a sweep along `u` (grid `i`, then `j`, then side, then `k`), starting from the end chosen by a seeded bit. This order is the **fill order** of §4.3. My call: a sweep, not a random order, so a partly built district looks like one area built in sequence rather than a scatter.

Each lot becomes a `ParcelRecord`-shaped site: the anchor's `id` and `labelPoint`, and the lot's ring as the polygon. It then goes through `normaliseSite` with the site's `edgeInsetM`. Gaps between buildings come from the edge inset plus the streets.

### 4.3 Massing a district

Each lot is massed by today's per-lot code, so all typologies, compositions, towers and roof accents apply unchanged. Lot `ℓ` gets the seed `mix(seed, ℓ)`, an integer hash of the site seed and the lot index (no transcendental math). Each lot therefore gets its own composition family and variety, and the result is stable across runs.

**Paint and yields (`generate`, max buildout).** Every lot is massed with `generate(lotRecord, env, mix(seed, ℓ), 'max')`.

- The I8 null rule applies to the district as a whole, not to each lot. The parcel's existing development is compared against the district's total floor area and total units.
- Lot-level massing ignores `existingUnits` and `existingFloorAreaM2`, which are passed as 0, because a large parcel's existing building cannot be attributed to individual lots.
- The ADU path never applies to a district.

**Pipeline and phases (`generateForUnits`).** Partner ruling, 2026-10-19: building after building, until the units are used up.

1. **Story count for each lot, `S_ℓ`.** The first rule that applies wins:
   - **Stated `stories` (tier 0):** every lot gets `S_ℓ = stories`.
   - **Curated DA height (tier 1, §4.6):** every lot gets `S_ℓ = ` the phase's curated stories, or else the master's.
   - **Otherwise (no evidence):** `S_ℓ` is a seeded uniform integer in `[DISTRICT_MIN_STORIES, L]`, drawn from `mix(seed, ℓ)`. `DISTRICT_MIN_STORIES = 3` (partner ruling). `L` is the story limit (below).
2. **Fill.** Walk the lots in fill order, massing each at `S_ℓ` with the reference massing `generate` uses (as in the paint case), and keep a running unit count.
   - Stop at the first lot `ℓ*` whose capacity reaches the remaining units.
   - Mass `ℓ*` with `generateForUnits(lot, remaining, L, mix(seed, ℓ*), S_ℓ*)`. Its footprint scales down, so the total lands on `U`.
   - Lots after `ℓ*` stay unbuilt, even if that leaves most of the site empty (partner ruling).
3. **Lots run out before the units do (my call).** Walk the lots again in fill order, raising each one to `L` (or to the stated stories, which are never changed), until `U` is reached. If every lot at `L` still cannot hold `U`, the result is approximate, as in today's case 3. `units` is still `U`.

**Story limit `L`.** Partner ruling: "3 to the zoned story limit". The caller passes `opts.storyLimit`, and the generator itself never reads zoning. timelapse-sim sets it in this order:

1. The largest T11 `envelope.maxStories` among the schedule's parcels that have an envelope. This is the zoned limit.
2. If no parcel has one (the `HP`, `CP`, `MB-RA` and similar height codes read as "none", `heights.ts:42-55`), the phase's curated `maxStories`, else the master's curated `heights.maxStories` (§4.6, tier 1). A phase max (amended 2026-10-19) covers a master whose phases have different D4Ds, e.g. the CP/HPS2 Shipyard phase.
3. Otherwise `districtMaxStories` from `projects.json` (tier 2): the 90th percentile of tier-0 stated stories over in-flight and completed records with at least `DISTRICT_DEFAULT_MIN_UNITS` units, computed by project-records with its `n` and provenance.
4. If `opts.storyLimit` is absent (another caller), `DISTRICT_FALLBACK_LIMIT` (tier 4).

`L` is at least `DISTRICT_MIN_STORIES` and at most `MAX_STORIES`.

The lots left unbuilt are deliberate. In a phase whose units do not fill its land, the empty lots stand in for the parks, R&D, retail and schools that DA sites contain and this model does not mass (non-goal). This replaces today's behaviour of thinning one huge building down until it fits.

### 4.4 The district result (I9 shape)

A district returns **one** `GeneratedBuilding` per site, so every consumer keeps its one-building-per-project or one-building-per-parcel contract. Its fields:

- `parts`: the concatenation of the lots' parts, in fill order. Parts are disjoint siblings, which I9 already allows ("siblings may have separate footprints"). The per-composition limits (`MAX_COMPOSITION_PARTS`, `MAX_COMPOSITION_VERTICES`) apply per lot, not per district.
- `typology`: the typology holding the most floor area across lots, ties to the later typology in I10 order. It is the district's headline typology (card, `parcelMeta`).
- **Per-part colour.** Each part gains an optional `lot?: number`, an index into `lots`. `pack-timed.ts` already writes one typology byte per part (`partTypology`), so it writes `lots[part.lot].typology` when `lot` is present, and each lot is coloured by its own typology. The paint map's packer (`pack.ts`) does the same if it has a per-part typology. If it does not, it uses the headline typology, and the builder records which applies.
- `composition`: the dominant lot's composition.
- `stories`: the tallest built lot's stories.
- `units`: `U` for `generateForUnits`. For `generate`, the sum across lots.
- `floorAreaM2`: the sum across lots.
- **New optional field** `lots?: { typology: TypologyId; stories: number; floorAreaM2: number }[]`, present only on district results and listing built lots only.
  - `massedUnits(b)` sums `unitsFor` over `lots` when the field is present, so `massingApproximate` stays correct when a district mixes typologies (65 m² against 70 m² unit sizes).
  - This is an additive I9 change. Consumers that ignore it are unaffected.

### 4.5 Stories on ordinary sites, options and card tier

- **Non-district sites:** unchanged, the fewest stories that fit (pipeline-massing §4.4; partner confirmed 2026-10-19). Curated heights are not applied on ordinary sites, so curation prioritises entries whose drawn sites are 2 ha or more.
- **`generateForUnits` options (amends T10).** A new optional last argument, `opts?: { storyLimit?: number; curatedStories?: number; openSpaceShare?: number }`. All of it is ignored on non-district sites.
  - timelapse-sim passes `opts` for every pipeline schedule massed on a district site, not only phases and masters.
  - It reads `districtMaxStories` from `projects.json` into `SimInput`, carries the T11 envelope through `MassingCtx`, and adds every `opts` field to `pipeKey`.
- **Card tier (amends T6).** `storiesTier` gains `1`.
  - A district built entirely at the curated DA height reports `1`.
  - A district with drawn heights (the no-evidence rule), or whose lots were raised under step 3, reports `4`, the existing "from the simulator's massing" tier.
  - The card's `stories` is the district's `stories`, its tallest lot.

### 4.6 Heights and open space in `multiphase.json`

The schema (`pipeline/enrichment/schema.ts`) gains:

- **On `MultiphaseEntry`:** optional `heights: { stories?: number; maxStories?: number; openSpaceShare?: number; facts: { stories?: Fact; maxStories?: Fact; openSpaceShare?: Fact } }`. These are the prevailing residential height, the tallest permitted height, and the share of land in parks and open space from the DA's design-for-development document. It is allowed whether or not `schedule` is null, so masters without phases can carry it.
- **On `MultiphasePhase`:** optional `stories?: number` with `facts.stories`, when the DA document gives a height for that phase.
- `stories` is an integer in 1..80. Where a document gives a height in feet, it is converted with `storiesFromFt` (tier 3, the existing rule) and the conversion is recorded in the fact's `locator`.
- project-records carries both values through to T3:
  - `phases[].stories: number | null` and `phases[].storiesTier: 1 | null`;
  - on the master, `daHeights: { stories: number | null; maxStories: number | null; openSpaceShare: number | null } | null`.
- The engine passes the phase's stories (else the master's) as `opts.curatedStories`, not as `stories`. It is a planned prevailing height, not a stated count for that building, so a phase whose units need more height still rises (§4.3 step 3).

**Data to curate (builder task):** the entries with the largest drawn area first: CP/HPS Phase 2, HPS Phase 1, Treasure Island, Mission Rock, Parkmerced, Pier 70, Potrero Power Station, India Basin, Balboa Reservoir, Stonestown, Schlage Lock, then the rest. Each value needs a `Fact` (URL, retrieved date, locator). An entry the builder cannot source keeps no `heights` and falls through to the drawn-height rule (§4.3).

### 4.7 Masters without phases

- `massingFor`'s early return for `multiPhase && phase === null` (`src/lib/sim/scenario/massing.ts:132`) is removed. A master without phases is massed like a pipeline project: one `generateForUnits` call on its free DA parcels (`parcelIds`) with its remaining units `R`, plus `opts` (§4.5): `curatedStories`, `openSpaceShare` and the `storyLimit` fallback from its `daHeights` when present.
- On most of these sites the result is a district (§4.1).
- A score-only master (no free parcel, DQ-3) still has no geometry.
- The 1 m footprint entry remains, but only as the fallback for a `null` or throwing generator.
- The card's `massing` becomes `'matched'` or `'approximate'` for these rows instead of `'none'`. timelapse-sim §4.9 and pipeline-massing §1 ("Unphased multi-phase rows are not massed") are amended.

### 4.8 Numbers this spec introduces

| constant | value | tier | basis |
|---|---|---|---|
| `DISTRICT_MIN_M2` | 20,000 | 2 | about two median SF blocks (below) |
| `BLOCK_U_M` × `BLOCK_V_M` | 167 × 73 | 2 | median size of SF's near-rectangular assessor blocks |
| `STREET_M` | 19.5 | 3 | SF's standard 64 ft residential right-of-way |
| `LOT_FRONTAGE_M` | 45 | 4 | made up; see the note below the table |
| `LOT_DEPTH_MIN_M` | 20 | 4 | made up |
| `LOT_MIN_M2` | 400 | 4 | the smallest lot `selectTypology` gives a podium (`select.ts`) |
| `BLOCK_MIN_M2` | 1,000 | 4 | made up |
| `OPEN_SPACE_SHARE` | 0.15 | 4 | default when there is no curated DA figure |
| `DISTRICT_DEFAULT_MIN_UNITS` | 100 | 4 | made up; the record filter for `districtMaxStories` |
| `DISTRICT_MIN_STORIES` | 3 | partner ruling | lower bound of the drawn heights |
| `DISTRICT_FALLBACK_LIMIT` | 8 | 4 | used only when a caller passes no `storyLimit` |

Source for the tier-2 rows: dataset `2026-10-19-547e741b`, with parcels grouped by assessor block. The 2,847 near-rectangular blocks (more than 85% of their minimum rotated rectangle filled) have a median length of 167 m (p25 125, p75 182) and a median width of 73 m (p25 61, p75 80), net of streets. The script is in the session scratchpad; the builder re-derives the figures in a pipeline-test note.

`LOT_FRONTAGE_M` is chosen so that a median block (167 × 73 m) splits into 2 × 4 lots of about 41.8 × 36.5 m. That is 1,524 m² each, just over the 1,500 m² tower threshold, so `selectTypology` can place towers on lots at tower heights. The builder may adjust it if edge insets push lots under that threshold.

**Known data gap (out of scope).** Several masters have only part of their site mapped in `projects.json`. Stonestown, India Basin, Schlage Lock and Pier 70 each have one parcel or none, and their densities come out at thousands of units per hectare. They stay below `DISTRICT_MIN_M2` and keep today's undershoot massing. Fixing them is parcel curation for project-records, not part of this spec.

## 5. Seams

- **Height zones.** A future `heights.zones` in `multiphase.json` could assign stories per block band, giving towers here and townhouses there. The district step already gives each lot its own story count internally, so a zone map plugs in at §4.3 step 1.
- **Real street plans.** A future per-project street-centreline file could replace the grid in §4.2 step 1 while keeping steps 2–5.

## 6. Testing

- **Unchanged and green:** `golden.spec.ts`, G1–G9, P1–P7, `generator.property.spec.ts` and the editor e2e suite. All their fixtures are below `DISTRICT_MIN_M2`, and a test asserts that they are.
- **New `district.spec.ts`:**
  - layout on a rectangle, an L-shape, a site with a hole and a two-component assembly: no lot outside the site, none in a hole, none under `LOT_MIN_M2`, streets ≥ `STREET_M`, open-space share within one block of target;
  - determinism and input-order independence;
  - transcendental-free (`determinism.spec.ts` covers the new file).
- **District goldens:**
  - a 40 ha synthetic site with `U` 3,454 and no stories: every built lot's stories in `[3, L]`, `units === U`, not approximate, more than one block built, and the same output for the same seed;
  - the same site with `curatedStories` 8: every built lot is at 8 stories;
  - the same site with `U` larger than `L` can hold: lots raised to `L`, approximate, `units === U`;
  - the same site with `U` 300 leaves lots unbuilt;
  - the same site under paint at S 8: every non-open-space lot is built.
- **Property:** for districts, `massedUnits` (lot-summed) is within tolerance of `U` whenever the full district at `Smax` holds `U`; every part lies inside the site; parts of different lots never overlap.
- **Perf:**
  - One district call on a 50 ha site costs ≤ 50 ms p99 in Node.
  - The worst real case, the Shipyard phase (265 ha, about 1,000 lots), costs ≤ 250 ms.
  - Massings are memoised across seeds (`pipeKey`), so a reroll pays this at most once per revision. The 3 s reroll budget holds. The paint brush over the largest real parcel stays inside the map perf bar (`bench:map`).
- **Pipeline:** the schema accepts and rejects the new fields; `districtMaxStories` is computed on the mini fixture; T3 validation of `phases[].stories` and `daHeights`.
- **Sim:** a master without phases with free parcels yields a building, not a footprint; a score-only master still yields none.

## 7. Acceptance criteria

1. Hunters Point Shipyard, Candlestick Point and Mission Rock render on `/fzp` as districts: streets, several buildings, heights at or above the curated or default stories. A screenshot of each is in the PR.
2. A painted large parcel on `/` renders as a district.
3. Every lot below `DISTRICT_MIN_M2` gives byte-identical output to `main`, and all existing generator goldens and properties pass unchanged.
4. No master without phases that has free parcels draws the 1 m sheet.
5. Every curated height carries a `Fact`. Every new constant carries a tier label in its doc comment.
6. The perf budgets in §6 hold. `bench:map` passes its p95 bar.

## 8. Partner rulings (2026-10-19)

- **Heights without evidence.** Use the §4.2 layout heuristic. In `/fzp`, draw building after building, each at a height chosen between 3 and the zoned story limit, until the units are used up, then stop, even if lots stay empty (§4.3). In paint, add units at the story limit the user set (§4.3).
- **Land used for things other than buildings** (streets, open space) is subtracted from paint and yield capacity (§3).
- **Ordinary lots** keep the fewest-stories rule (§4.5).
- **My calls**, within those rulings:
  - the story limit `L` when zoning gives none (§4.3);
  - raising lots to `L` when the lots run out (§4.3 step 3);
  - curated DA heights count as evidence, so all lots use them (§4.3 step 1).
