# Generated building compositions and parcel fitting

Date: 2026-10-11
Status: Draft for user review; implementation is not authorized by this document alone.

## 1. Purpose and agreed direction

The simulator lets people imagine San Francisco with enough housing and express their own preferences for what “enough” means by painting allowed heights. Generated buildings should make those choices understandable at the elevated camera angles used to view a neighborhood or the city.

Today, painting a district at five or six stories produces repetitive rectangular masses. Taller development repeats a broad base with one tower. The proposed change adds recognizable, varied building compositions that fit their parcels, using modest amounts of geometry and flat colors. Both the neighborhood roofscape and the larger skyline matter.

The intended visual language is an architectural model. Photorealism, textures, individual windows, and detailed façades are outside this version. The design does not assume that mobile hardware has unlimited geometry capacity: performance must be measured with representative compositions.

This work owns generated-building parcel fitting and composition. The other Codex agent is improving as-built structure rendering; that work is independent. There is no separate lot-fitting agent or dependency on one.

## 2. Scope and alternatives

Three approaches were considered: procedural façade patterns, a catalog of complete building models, and a small procedural composition vocabulary. Façades have limited impact from the normal elevated view. Complete models require awkward deformation to fit irregular parcels. Use the composition vocabulary: generate a few meaningful arrangements of supported volumes, conditional on parcel geometry, then add restrained roof treatment and color variation.

In scope:

- Parcel-aware base footprints, upper volumes, terraces, and roof terminations.
- Several compositions for buildings around five to six stories and for taller buildings.
- Deterministic variation by parcel, with stable preferences as allowed height changes.
- Floor area and housing yields calculated from the occupied geometry.
- Worker generation, binary packing, generated-layer rendering, picking, and performance verification needed for those changes.

Out of scope:

- Texture assets, façade windows, individual balconies, realistic materials, and photorealistic lighting.
- As-built geometry, tile production, and changes to that agent's renderer.
- Parcel assembly, new street-frontage data, entrances, detailed architectural feasibility, or building-code compliance.
- Changes to brush controls, zoning policy levers, eligibility, or the existing typology selection thresholds.
- A new shared-plan schema or historical generator replay system.

## 3. Current behavior and constraints

Parcel records are static dataset records, not simply existing building footprints. They include a local-metre polygon, `areaM2`, existing development information, and a label point. The generator currently derives site area from the polygon and uses it for coverage and typology selection.

Relevant current behavior:

- `site.ts` simplifies the largest parcel outer ring and insets it; it currently drops holes.
- `select.ts` selects typology using painted stories and site area, with smaller parcels capped to a lower typology and story count.
- `massing.ts` creates a coverage-limited base. Most low buildings use one extrusion; midrises step back above floor six; towers use a five-story base and one upper plate.
- The current tower upper-plate target is `min(900 m², 0.35 × site area)`. The base coverage is 0.8. These remain aggregate constraints, including when an upper plate is divided into two towers.
- `GeneratedBuilding.parts` describes occupied vertical intervals using `baseM` and `topM`, but the map packs only `topM` and renders solids from the ground. That works because upper footprints are supported by occupied volumes below.
- Current containment comments and tests assume sequential nesting. They must change to allow supported sibling volumes.
- Six existing geometry random draws have a frozen order. Appearance and composition must not shift that stream.

The five-story base in the current code should not be confused with the visually shallow base described in the discussion. This design addresses the repetitive composition without relying on that description as a literal floor count.

## 4. Composition vocabulary

### 4.1 Buildings around five to six stories

The goal is a coherent height band with an irregular roofscape. Do not randomly reduce entire buildings below their selected story count.

Provide three families across the relevant walkup and podium typologies:

| Family | Composition | Elevated-view effect |
| --- | --- | --- |
| Simple block | Parcel-fitted body, restrained inset roof cap | Quiet background buildings remain part of the district |
| Partial terrace | Lower body with a modest setback affecting part of the final occupied floor | A readable terrace and an asymmetric roofline |
| Divided upper section | Shared lower body with two supported upper sections separated by a recess on the final floor | Breaks up broad roofs without pretending to subdivide the parcel |

The upper-floor change affects only the final floor at these heights. The retention rule in section 6 limits its size. Narrow sites can receive a simple block or a modest end setback; they must not receive thin decorative wings merely to force variety.

Plexes and ADUs retain their existing occupied massing and yield rules in this version. They may receive the inexpensive roof-cap and tone treatment. The five-story small-lot walkup is explicitly included in the richer vocabulary, even though its typology name is not “midrise.”

### 4.2 Midrises

For existing eight-to-twelve-story midrises, reuse the three families with a shared lower body and up to two distinct upper stages. The current setback above floor six is the baseline; variations redistribute upper-floor area within the same coverage, support, and retention constraints.

Changes to upper-stage height use integer floor boundaries. At least one occupied section reaches the selected story count. No extra floor is added as decoration.

### 4.3 Taller buildings

Provide four families:

| Family | Composition |
| --- | --- |
| Slab | An elongated upper volume above the base, with restrained roof treatment |
| Shouldered tower | A wider upper section that narrows over its final one or two occupied floors |
| Offset composition | An asymmetrically positioned upper volume, optionally with a lower supported shoulder |
| Paired towers | Two separated upper volumes above a common base; one may finish one or two floors below the other |

Keep the existing five-story base rule initially. Break its visual repetition through the parcel-fitted base outline, upper-volume arrangement, exposed terrace surface, and a restrained difference in tone. Varying base height would change another capacity assumption and is outside this version.

Paired towers share the existing total upper-plate area budget; each tower does not receive a separate 900 m² allowance. Each upper volume must have at least 150 m² of floor plate, retain a six-metre-wide core after fitting, and be separated from its sibling by at least six metres. These are modeling guardrails, not assertions of code compliance. If they do not fit, choose another family.

### 4.4 Roof treatment and colors

Choose a quiet roof termination or one shallow inset cap. At most two roof accents per building, attached to the highest occupied roofs and fully supported below. A cap is a schematic roof feature, not another dwelling or a full mechanical penthouse.

Roof accents stay within the existing building-specific parapet allowance above `floorTop(typology, stories)`. They contribute no residential floor area. Terraces are the exposed tops of lower occupied volumes and do not require furniture, railings, or planted objects.

Use a bounded tone variation within the existing typology palette. Each whole solid can use a body, upper-section, or roof tone; separate wall and roof-face materials are not required. Generated development must remain distinguishable from existing development in both themes. New colors must preserve the established typology contrast ordering; if they cannot, omit tone variation and retain composition variation.

## 5. Parcel fitting

### 5.1 Buildable domain

Work in the existing local-metre coordinate frame and clipping precision. The real parcel boundary is the authority; the principal axis supplies orientation, not a replacement rectangle for the parcel.

Resolve input rings with the established even-odd interpretation. Continue using the largest connected parcel component for this version; do not span disconnected components. Preserve any holes in that component as exclusion regions when measuring area and validating candidates. Simplification must not create development outside the original domain: intersect the simplified domain with the original before using it.

Apply the existing edge inset and coverage rules to that domain. Area used for selection and coverage excludes holes. Differences from the old hole-dropping behavior must be covered by fixtures and documented as a correctness change.

### 5.2 Fitting procedure

1. Construct the normalized, inset buildable domain and its canonical local axes.
2. Generate the simple reference composition under the existing typology, coverage, and height rules, using the corrected parcel domain.
3. Enumerate compatible families from dimensions, available area, height, and component geometry.
4. Use the parcel's deterministic family preference order. Fit candidate regions by intersection with the buildable domain and supporting volume below.
5. Drop fragments below the existing 10 m² minimum. Every occupied component must survive a 1.5 m inward offset; tower components also meet the stronger section 4.3 guardrails.
6. Validate full polygons, including edges and interiors, against the domain and exclusions. Vertex containment alone is insufficient for concave lots.
7. Validate support, coverage, height, capacity retention, and geometry budgets. Select the first valid candidate.
8. If no richer family fits, use the validated simple reference. If there is no valid reference, return `null` under the existing safe-failure behavior.

The current output carries simple rings without holes. Do not emit a filled outer ring over an excluded region. A candidate with an interior hole is rejected in this version; the deterministic fallback may fit a smaller simple region using axis-aligned cuts through the exclusion. Try cuts at the exclusion's projected minimum and maximum on each local axis, in canonical order, and validate the resulting components. If this cannot produce a valid composition in the simple-ring representation, return `null`. General polygon-with-hole rendering and arbitrary triangulated buildings are outside scope.

All fallback fitting obeys the same constraints. Never fall back to an unchecked bounding box or the current hole-dropping implementation. No street-facing orientation is inferred from a long axis; frontage is not available in the current parcel record.

## 6. Capacity, height, and accounting

The painted value remains an allowed-story ceiling. Existing parcel-size caps, floor heights, typology rules, efficiency, average unit areas, maximum-unit rules, and replacement-gain checks remain in force.

Build an occupied model as a small sequence of floor bands. Each band has an integer first floor, an integer floor count, and non-overlapping footprint components. Upper occupied footprints must be supported by the union of occupied regions immediately below. No cantilevers, floating parts, or overhangs are introduced.

Compute gross floor area as the sum, over bands, of union footprint area multiplied by floor count. Never sum overlapping sibling footprints twice. Feed that result into the existing unit-yield formula and existing eligibility/gain checks. `stories` is the highest occupied floor, not the sum of the heights of sibling towers. Roof accents do not count as stories or floor area.

A richer candidate must retain at least 90% of the validated simple reference's gross floor area and at least 90% of its unit count, rounded up. It must still pass all existing gain checks. This bound is a modeling choice to prevent ornamental variation from materially hollowing out dense districts; it does not permit inflated reported totals. Candidate floor areas may differ, and the scoreboard must show the actual selected result.

Check height sweeps for unexpected capacity drops caused by family selection. Within an unchanged typology and compatible family, raising the allowance should extend the composition rather than arbitrarily carve away more occupied area. Existing typology transitions have different coverage and unit-size assumptions; this work does not introduce a new cross-typology optimization or change those policy rules. Report any inherited threshold discontinuities separately instead of quietly changing typology selection to hide them.

The existing `max` mode remains a deterministic capacity model under typology assumptions, not an exhaustive architectural optimizer. User-facing explanatory copy should state that capacity is estimated from the modeled building forms and is not a development forecast. Do not describe a shape with less occupied area as housing that the scoreboard still counts.

## 7. Deterministic variety

Derive independent named streams from parcel identity for family preference, composition proportions, roof treatment, and tone. Keep the existing six geometry draws untouched. Adding a roof choice must not move a tower or alter the existing setback draw sequence.

Family preference and orientation preferences do not include painted height in their seeds. Reuse them while increasing height and expanding the compatible vocabulary. Family changes are permitted when a typology boundary or fit constraint makes the earlier family incompatible; unchanged parcel, envelope, and generator version must always reproduce identical output.

Use deterministic tie-breaking, canonical ring ordering, and fixed candidate limits. The preferred family list is a seeded permutation of the compatible families, with uniform preference among them. Independent parcel seeds provide neighborhood variation without a neighbor-dependent selection algorithm that changes when chunks load.

## 8. Architecture and interface changes

Keep generation pure and worker-safe. Separate responsibilities into small modules:

- Site/domain normalization and validation.
- Composition recipes and conditional family selection.
- Occupied floor-band accounting and support checks.
- Roof accents and appearance choices.
- Packing and generated-layer rendering.

The implementation plan may choose filenames, but it must keep fitting, capacity accounting, and rendering independently testable.

### Generator output

Retain the `GeneratedBuilding` top-level capacity fields and simple footprint rings. Add a composition-family identifier and per-part role (`occupied` or `roof`) and tone index. Occupied `baseM`/`topM` describe true occupied intervals. Roof parts use their actual attachment height and zero occupied floors internally.

Replace sequential nesting with this contract: at every occupied band's base, its footprint is contained by the union of occupied footprints supporting it below. Siblings at the same elevation have disjoint interiors. Every part is inside the parcel domain. This permits two towers supported by one base.

Update the interface descriptions and tests in the generator and map specs as part of implementation. This document supersedes their sequential-nesting rule for generated buildings; other interface requirements remain in effect.

### Packed rendering

The ground-to-top extrusion path remains usable because every part has a continuous supported column below it. Rendering those columns produces the same exterior union; it does not redefine occupied floor area. Therefore this version does not require floating solids, a general mesh renderer, or a `partBaseM` buffer.

Add one per-part appearance byte encoding the finite role/tone choices to `PackedCell`. Update empty packs, concatenation, transfer lists, fixtures, and packing determinism checks together. Keep `partSlot` and `parcelMeta` authoritative for picking and summaries: a roof or either tower selects the same parcel and shows one total unit count.

Keep one settled generated layer per cell and the existing transient rising layers. Retain revision ordering, hide/restore behavior, reduced-motion behavior, and the 400 ms rise animation. All parts share the same elevation scale so roofs stay attached during rise-in. No generated layer is created per building or per detail.

## 9. Geometry and performance budgets

Initial limits for richer compositions per building:

- At most eight occupied solids and two roof accents.
- At most 128 footprint vertices across all emitted solids.
- At most four fitted parameter candidates per family before falling back.
- Candidate evaluation and clipping in the worker; no generation during pan or paint-pointer movement on the main thread.

If a richer candidate exceeds a budget, reject it or remove optional roof accents. Do not simplify geometry in a way that crosses a parcel boundary. Failure of a roof accent must not change occupied capacity. A validated simple reference may exceed the vertex or component budget when its parcel boundary requires it; retain that reference without accents and record this case in the benchmark. Visual-detail budgets must not turn otherwise valid housing into `null` or distort its boundary.

No texture downloads, new texture atlases, or new runtime dependencies are required by this design. Do not add zoom-dependent regeneration in the first version. If the measured budgets fail, reduce optional geometry or introduce a separately specified level-of-detail step while preserving the same occupied model and scores.

Preserve the existing targets: first rising frame within 30 ms of receiving a 500-parcel update, no main-thread long task above 50 ms during a whole-city update, and real-GPU p95 pan frame time at or below 16.7 ms on the documented M2-class target. Measure worker generation as well: the existing 150 ms pointer-up-to-display target for at most 500 loaded parcels remains the end-to-end target, including composition candidate evaluation.

## 10. Verification and visual acceptance

### Geometry and accounting

Use the existing standard, shallow, narrow, L-shaped, holed, and multipart lot fixtures, plus a broad lot suitable for paired towers. Verify:

- Full polygon containment after fitting and after output coordinate rounding, with no exclusion overlap or boundary crossings.
- Width, minimum-area, coverage, tower separation, support, and total upper-plate constraints.
- Correct union-area accounting for stepped volumes and sibling towers; decorative parts add zero housing.
- Height ceilings, selected-story reporting, retention bounds, gain checks, and height sweeps that distinguish new composition regressions from inherited typology transitions.
- Stable output across repeat calls, ring rotations/reversals, chunk load order, reload, undo, and erase/repaint.
- Valid bounded fallbacks and safe rejection of malformed or unrepresentable sites.

### Rendering and interaction

Check byte-identical packing, appearance-buffer transfer/concatenation, correct parcel picking on every part, roof attachment during animation, reduced motion, revision resets, and existing-building hide/restore. These are regression checks for the generated layer; the as-built agent's rendering implementation is not modified by this work.

### Visual review

Compare before and after at the actual elevated camera angle in both themes and at desktop and mobile viewport sizes:

1. A dense district painted to five stories and then six stories, including small walkup lots.
2. A district painted to eight and twelve stories.
3. Large tower-eligible parcels at twenty and forty stories.
4. Irregular, narrow, holed, and edge-case lots with overlays showing parcel boundaries.

On a fixture group where all low-rise families fit, all three must be visibly represented. On a fixture group where all tower families fit, all four must be represented. The district should retain a coherent height band at five to six stories; taller districts should show visibly different silhouettes. Variety must be readable from the normal camera, not only from an isolated close-up.

Performance fixtures must contain the new compositions at representative and worst-case geometry budgets, rather than only the current one- or two-part synthetic boxes. Record measured generation, update, and GPU performance. Do not claim mobile suitability solely from the absence of textures or a desktop GPU result.

## 11. Compatibility and delivery boundary

There is no parcel-data schema, database, brush-plan, or shared-plan payload change. Internal generator and packed-cell changes ship together in one application release. Worker caches remain scoped to a dataset and application runtime; candidate evaluation uses the fixed limits above.

Plans store paint instructions and dataset identity, not frozen generated buildings or a generator version. Reopening an existing plan after this change can therefore show new forms and different calculated totals. This design accepts recomputation under the current model; it does not promise immutable historical yields. Note that behavior in release documentation and in the existing explanatory copy for model estimates.

Deliver this design for review before writing the implementation plan. Implementation should subsequently cover generator fitting/compositions/accounting, packed appearance/rendering, and representative visual/performance validation. No product code is changed as part of this design-writing task.
