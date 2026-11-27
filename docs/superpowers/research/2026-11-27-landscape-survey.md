# Housing forecasting landscape: who else is building this (2026-11-27)

A survey of models, tools, games and data close to SF Housing, for deciding what to adopt, whom to
validate against and whom to approach. Three research agents swept (1) academic, government and
nonprofit models, (2) public tools and games, (3) commercial products, data and empirical
parameters. Tags: **[V]** read on the primary page, repository or PDF; **[P]** press or secondary
source only; **[U]** unverified. Collaboration angles and rankings are judgement, not findings.

## Verdict

Nobody public does what SF Housing does: a per-parcel, month-by-month forecast with a developer
choosing each lot's building, permitting timers by route, public funding pools, cars and transit,
calibrated on SF permit records, played as a game toward a dated goal. The field splits into:

- **Statistical development-probability models** (SF Controller, SF Planning/Blue Sky, Rezoner,
  YIMBYdata, Romem/LA): annual, per parcel, no timers or money. Best for validating start odds.
- **Pro forma feasibility simulators** (Terner Labs, UrbanSim/BAUS, pyforma): per parcel, closer
  mechanically, but closed (Terner) or 5-year regional (BAUS).
- **Public-facing games and maps** (YIMBY NYC, Permit Pending, Cityscaper, MIT City Science,
  Balancing Act): engagement without a calibrated engine, or an engine without SF.
- **Commercial site tools** (TestFit, Deepblocks, Prophetic, Zoneomics): one site at a time, for
  buyers. Not relevant beyond data.

The one-sentence pitch to every group below: SF Housing is the open, public, time-stepped front end
that the parcel-probability and feasibility communities have each asked for and nobody has built.
CalHDF's 2025-10-29 letter to the Board of Supervisors demanding a parcel-level
"probability-of-development analytical model" for SF is, in effect, a request for this project.

## Top leads, in order

| # | Who | Why | Ask | Contact |
|---|---|---|---|---|
| 1 | **Terner Labs Housing Policy Simulator** | Nearest analog: parcel pro forma → logit chance of building, policy levers (density bonus, fees, streamlining, parking, SB 79). Closed, no SF profile on the public viz | Cross-check pro forma defaults and start odds; propose SF profile or SF Housing as their open public front end; Home Genome Project (below) | Ruby Bolaria Shifrin, Ben Metcalf |
| 2 | **SF Controller, Office of Economic Analysis** | Official FZP forecast (8,504 / 14,646 units by 2045) with full coefficient tables published. Already cited in `2026-11-09-financing-evidence.md` | Parcel-year panel (3.37M rows, 2004–2024); review of SF Housing's current-law and FZP runs | Ted Egan, ted.egan@sfgov.org |
| 3 | **Salim Damerdji: Rezoner + YIMBYdata/housing-elements** | Open per-parcel development probabilities for SF (Rezoner, R Shiny) and the open realization-rate study of housing-element sites (with Kapur, Elmendorf, Monkkonen) | Licence on both repos; independent check on start odds; calibration reviewer; co-promotion via SF YIMBY | damerdji.bsky.social; Elmendorf (UC Davis Law), Monkkonen (UCLA) |
| 4 | **Brookings 17 Rooms "Home Genome Project"** | Proposal (2025-10-27) for open parcel data, open zoning/pro forma simulators and AI supply models, 4–6 pilot cities. Room includes Terner Labs, National Zoning Atlas, Chan Zuckerberg Initiative | Offer SF Housing as an open module / SF as a pilot city. No pilot found yet | Rosanne Haggerty, Ruby Bolaria Shifrin |
| 5 | **CALES (O'Neill & Biber, UC Berkeley, for HCD)** | Measured SF entitlement times by route, 2014–2021 (e.g. SB 35 median 3.4 mo; discretionary 5+ units 27 → 34 mo) | Project-level data behind the report, to set or check timer floors | Moira O'Neill, Eric Biber |

Next tier: **MTC/ABAG Bay Area UrbanSim** (open code, licence and inputs to ask), **SF Planning**
(Blue Sky model files and the FZP feasibility model's inputs, sf.housing.choice@sfgov.org),
**YIMBY NYC** (closest game design), **MIT City Science SF** (public-engagement table).

Funder: **Coefficient Giving** (Open Philanthropy until 2025-11-18) funded Terner's Housing Policy
Dashboard ($75k, 2023) and California YIMBY ($3M, 2025) [P]. The likeliest funder for an open SF tool.

## 1. Models close to the engine

### Development-probability models (validate start odds against these)

- **SF Controller OEA, FZP Economic Impact Report** (2025-10-29) [V]. Stage 1: logit on every
  parcel-year 2004–2024 (n = 3,369,573, 422 starts, max-rescaled R² 0.245) on height limit, lot
  area, envelope, existing building sf, existing residential, historic status, real construction
  cost and Zillow condo index (2-yr lags), density-bonus eligibility, zoning and district dummies.
  Stage 2: OLS units on envelope (383 projects >10 units, R² 0.87). Forecast 2026–2045 under two
  price/cost scenarios; also 500–1,000 extra demolitions. Coefficients pp. 28–35; no code.
  https://newspack-missionlocal.s3.amazonaws.com/mission/wp-content/uploads/2025/10/250700_economic_impact_final.pdf
- **SF Planning / Blue Sky Consulting, Housing Element 2022 sites model** [V]. Logit on 2001–2021
  multifamily development; 9,130 probable private units on underused sites. Same lineage the
  Controller refined (inference). Method in Appendix B; sites spreadsheet B.4 downloadable; no code.
  https://sfplanning.org/sites/default/files/documents/citywide/housing-choice/housingchoice_element_appendixB_sites_inventory.pdf
- **SF Planning FZP capacity factsheet** (July 2025) [V]: citywide approval-rate method 39,000;
  soft sites 45,000–64,000 (residential sites discounted 98%); financial-feasibility model ~19,000
  moderate/above-moderate (UrbanSim-based per `2026-10-16-fzp-calibration-literature.md`). Already
  cited there.
  https://sfplanning.org/sites/default/files/documents/citywide/FZP-Factsheet-Capacity-Calculations.pdf
- **Rezoner / RezoneSF** (Salim Damerdji) [V]. R Shiny + Mapbox; per-parcel probability from a
  regression on past development with transit, walkability, resources and zoning; rezone by block
  and lot. https://github.com/sdamerdji/rezoner (no licence, last push 2025-08-04).
- **YIMBYdata/housing-elements** (Kapur, Damerdji, Elmendorf, Monkkonen) [V]. Matches Bay Area
  5th-cycle site inventories to permits; median city builds on ~8% of listed sites, ~3% of
  non-vacant. Includes an SF permit loader. https://github.com/YIMBYdata/housing-elements (no
  licence shown) · https://www.lewis.ucla.edu/research/what-gets-built-on-sites-that-cities-make-available-for-housing/
- **Romem / MetroSight LA probability model** [V]. Logit on LA permits 2015–2019; average parcel
  1.49% over 5 years. Method in LA Housing Element Appendix 4.6.
  https://planning.lacity.gov/odocument/15117d38-35ca-416b-9980-25eb20201ba2/Appendix_4.6_-_Regression_Methodology.pdf

### Pro forma and microsimulation models

- **Terner Labs Housing Policy Simulator** [V]. Per parcel: envelope, building type, fees,
  CoStar rents and cap rates; best of 61 project sizes (2–1,000 units); monthly cash flow over 10
  years; NPV/equity into a pooled hierarchical logit recalibrated to permitted units. Published
  defaults: 65% loan-to-cost, 10% preferred return, 30 units/month absorption, 3% inflation,
  construction 14/18/24 months (low/mid/high-rise). Market-rate rentals only. Runs on MapCraft
  (commercial). Public viz: Denver, San Diego, Tucson (2026-05-14). An older "Policy Gauge" listed
  SF [P]. Methodology: https://www.ternerlabs.org/terner-housing-policy-simulator-full-methodology
  · viz: https://housing-policy-simulator-viz.ternerlabs.org/
- **Bay Area UrbanSim (BAUS), MTC/ABAG** [V]. Parcel microsimulation in 5-year steps behind Plan
  Bay Area 2050+ (adopted March 2026); for-profit developer with a simplified pro forma, non-profit
  developer drawing on affordable-housing accounts (cf. our funding pools), pipeline list, ADU
  model. Public on GitHub, no licence file; some inputs on MTC servers; parcel/zoning inputs in
  BASIS. https://github.com/BayAreaMetro/bayarea_urbansim
- **UDST `urbansim` / `developer`** (BSD-3 core) and **pyforma** (Oakland Analytics) [V]: open
  pro forma engines; reference designs for building choice.
  https://udst.github.io/developer/developer.html · https://github.com/oaklandanalytics/pyforma
- **Urban Institute Housing Market Forecaster** [V]: regional supply and demand by PUMA over 10
  years with levers (vouchers, land use, subsidies); DC and Chicago. A demand side we lack.
  https://www.urban.org/urban-wire/new-tool-can-help-forecast-housing-market
- **Envision Tomorrow** (Fregonese) [P]: open-access prototype pro formas; cost reference.
- **ABAG Middle Housing Feasibility Tool** and **HESS** [V]: login-gated Bay Area pro forma and
  site screening; contact ABAG (Clair McDevitt; housingTA@bayareametro.gov).
- **Low fit:** PECAS (regional input-output, mostly stale), Massachusetts MBTA Communities
  compliance model, Mercatus parcel theory papers, CoRenew (LLM-agent negotiation preprint,
  arXiv 2607.25447), a journal article on procedural urban digital twins for SB 9 [U].

### Proposals and announced work

- **Home Genome Project** (Brookings, 2025-10-27) [V]: see top leads.
  https://www.brookings.edu/articles/home-genome-project-ai-housing-supply/
- **FAS "National Housing Policy Simulator"** (Ben Metcalf, 2024-02-20) [V]: $10–10.5M via HUD
  PD&R for a national Terner-style simulator; no sign it was funded.
  https://fas.org/publication/national-housing-policy-simulator/
- **CA Office of Data & Innovation "Homestead"** [V]: early trial cleaning APR data for 539
  jurisdictions, SB 423 eligibility checks. Contacts on the page.
  https://hub.innovation.ca.gov/data/building-housing-intelligence
- Not found: a HUD digital-twin grant, a Terner or California YIMBY SB 79 capacity estimate, any
  government RFP for a housing forecasting model, Arnold Ventures or Schmidt Futures work here.

## 2. Public tools, maps and games

### Closest to SF Housing as a product

- **YIMBY NYC** (Kaighn Kevlin, April 2026) [V]. 10,000 household agents in 55 NYC neighbourhoods,
  monthly ticks 2020–2070, units auctioned to bidders, developers run a pro forma each month;
  levers: parking minimums, upzoning, land value tax, 100% affordable mandates, CEQR. Rust, no
  licence, self-described "vibe coded". Closest game design; its demand side complements our
  supply side. kaighn.com/yimby · https://github.com/KaighnKevlin/yimby
- **Cityscaper** (SF10x hackathon, 2025-08) [V]. Rezoner probabilities corrected to Planning's
  forecast pick redeveloping parcels; Google Earth before/after for 2036. CC BY-SA 4.0, no code.
  Team: Joe Foster, Mike Hankin, Vivien Kong, Eric Munsing, Calvin Rogers. GrowSF judged.
  http://cityscaper.org
- **MIT Media Lab City Science, civic simulation platform for SF** [V]. CityScope table comparing
  current zoning with FZP on housing, mobility and amenities, weighted by residents' input; a "City
  Science Lab @ San Francisco" is in development. Offer our engine as its housing module. Kent
  Larson, Ariel Noyman.
  https://www.media.mit.edu/projects/a-civic-simulation-platform-for-san-francisco/overview/
- **Permit Pending** (Peter Cai, 2026) [V]. Browser city-builder as mayor; projects go through
  review, hearings, lawsuits, appeals, a council and re-election. The political counterpart to our
  timers. https://permit.petercai.com/
- **Balancing Act Housing Simulation** (Polco) [V, vendor]. Residents paint rezoning on a map to
  hit a unit goal (Santa Barbara County, Elk Grove). Commercial; the same "paint to the goal"
  mechanic as our opening. https://abalancingact.com/solutions/housing

### SF maps (co-promotion, press)

- **SF Planning** FZP map and Housing Dashboard [V]: https://sfplanning.org/sf-family-zoning-plan
- **FoglineSF 3D FZP map** [P]: parcels extruded to height limits with bonus tiers; builder unknown.
  https://foglinesf.github.io/sf-family-zoning-plan/maps/3d_map.html
- **Mission Local parcel map** (Kelly Waldron, Io Yeh Gilman, 2025-10-18) [V]: 92,744 parcels with
  zoning, assessor data and rent-control exposure. A natural launch press partner.
  https://missionlocal.org/2025/10/explore-how-will-sf-zoning-affect-your-neighborhood/
- **SB 79 maps** (MTC regional map; SF per-parcel in the Property Information Map) [V]: inputs for
  an SB 79 policy. https://mtc.ca.gov/planning/land-use/senate-bill-79-regional-map
- Low value: vadimg/sfzoning (unmaintained), a handful of 0-star student repos.

### Serious games (genre peers)

Microlandia (Steam, real-data SimCity-like) [P]; Sim Nimby (2022 SF satire) [V]; RenewCity
(Detroit, Steam, March 2027) [V]; SIM-PHL (Drexel, Knight-funded, stale) [P]; ZONE! (UW–Stevens
Point) [P]. Precedent and audience, not collaborators.

### Platforms (low fit)

ArcGIS Urban, UrbanSim Inc.'s UrbanCanvas, Envelope (NYC), UrbanFootprint (now LightBox): closed
commercial scenario tools. Not researched: Hello Lamp Post, Commonplace, Maptionnaire, Decidim,
Polis (unknown, not absent).

### Advocacy audience

- **CalHDF letter** (2025-10-29) [V]: calls SF's soft-site assumptions (2% residential, 70%
  non-residential redevelop) "not an analytical model" and asks for a probability-of-development
  model.
- No simulator found from GrowSF, SF YIMBY, Abundant Housing, Sightline, Pew, Mercatus or the
  Substack writers. GrowSF and SF YIMBY are the circle around Rezoner and Cityscaper.

## 3. Data and parameters to adopt

| Source | What | Use | Status |
|---|---|---|---|
| Controller OEA coefficients | Per-parcel logit and units regression | Prior for start-odds effects (historic, existing residential, density bonus) | [V] in use via financing-evidence |
| Controller Inclusionary Triennial 2026 | 5 condo + 5 rental prototypes, 80 scenarios; no rental prototype feasible | Developer choice costs | [V] in use |
| BLA "Financial Incentives for Housing" (2026-05-05) | Feasibility gap $80k–$308k/unit; costs +53.5% 2019–2025 | Market terms | [V] https://media.api.sf.gov/documents/Policy_Analysis_Housing_Incentives.pdf |
| BLA post-entitlement permitting memo (2026-03-05) | 280-day median after entitlement | Timer floors | [V] https://sfbos.org/sites/default/files/BLA_Post_Entitlement_Permitting_030526.pdf |
| CALES (O'Neill & Biber) | Entitlement times by route | Timer floors | [V] https://www.hcd.ca.gov/sites/default/files/docs/policy-and-research/plan-report/ucb-examining-local-law-policy-planning-practice-on-development-in-sf-using-cales.pdf |
| AHSAS final report (Dec 2025) | 12,600+ affordable units in 59 projects waiting for funds; land costs from 53 sales | Funding queue, land cost | [V] https://sfplanning.org/sites/default/files/documents/citywide/AHSAS-final-report-2025.pdf |
| DataSF Development Pipeline | Quarterly per-project snapshots | Starting state, calibration | [V] Older snapshots being retired: ask the owner (Ken Qi) now |
| HCD APR Table A2 | Per-project entitlements, permits, completions 2018– | Validation | [V] Portal file last updated 2022; HCD migrating |
| Terner Labs defaults | LTC, preferred return, absorption, construction months | Cross-check pro forma | [V] |
| Terner cost work | CA multifamily ~2.3× Texas; structured parking ~$36k/unit | Cost parameters | [V] |
| Greenaway-McGrevy (Auckland) | Broad upzoning ~doubled construction, ~5% of stock | Sanity bound for big upzoning scenarios | [V] |
| Urban Institute panel vs AEI critique | +0.8% supply over 3–9 yrs vs 1–2.5%/yr for by-right | Bounds; sources disagree | [V] |
| Houston lot-size reform | 34k townhouses 2007–2020, ~0.5% of SFH parcels redeveloped | Small-lot redevelopment rate | [V] |
| Terner "SB 9 Turns One" | Near-zero uptake vs 700k "feasible" | Keep small-lot paths near zero | [V] in use (calibration literature) |
| Open Zoning Feed Spec (Harvard GSD ViBE Lab) | GTFS-like zoning schema, in refinement | Publish SF zoning in it from the pipeline; cheap way to become infrastructure | [V] https://research.gsd.harvard.edu/vibelab/2025/08/19/open-zoning-feed-specification-ozfs/ |
| Regrid "Data With Purpose" | Nationwide parcels + zoning, nonprofit licences | Only if we expand beyond SF; research licence may conflict with ODbL | [V] |
| CoStar/Yardi broker summaries | SF pipeline 4,163 units Q3 2026, zero completions two quarters | Near-term check | [P] |

## 4. Commercial (closed, site-level; low fit)

TestFit (MCP support from Aug 2026), Prophetic (D.R. Horton, M/I Homes), Deepblocks, Zoneomics,
Acres, Symbium (SF; encoded SF Planning rules since 2018, possible data partner), Envelope,
UrbanFootprint/LightBox, CoStar, Yardi Matrix. Nothing usable found on Cotality, ATTOM, Hello Data,
Zonda, John Burns, Cover, Archistar, Gridics, Cityzenith.

## Suggested outreach order

1. **Ted Egan** (Controller): parcel-year panel; review our FZP comparison.
2. **Terner Labs** (Shifrin, Metcalf): cross-validation, SF profile, Home Genome Project.
3. **Salim Damerdji**: licences on Rezoner and YIMBYdata; calibration review; SF YIMBY co-promotion.
4. **SF Planning** (sf.housing.choice@sfgov.org; Ken Qi for pipeline history): Blue Sky and
   feasibility model inputs, pipeline snapshots before they are retired.
5. **O'Neill and Biber**: CALES project data.
6. **MTC BAUS team**: licence, inputs, SF 2050 totals to compare.
7. **Kaighn Kevlin**, **MIT City Science**, **Mission Local**: design exchange, module offer,
   launch coverage.

Before any outreach, a side-by-side of SF Housing's current-law and FZP runs against the
Controller's 2045 range and Planning's three capacity figures would give every conversation a
concrete opening.
