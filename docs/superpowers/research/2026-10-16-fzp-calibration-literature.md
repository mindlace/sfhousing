# FZP timelapse: calibration literature survey (2026-10-16)

Survey report by a research agent for the `fzp-timelapse` composition. Confidence tags: **[A]** official primary source read, **[B]** secondary/news or partly verified, **[C]** inference. Evidence tiers (partner ruling) are applied in the design doc, not here.

## 1. Family Zoning Plan facts

- Planning Commission 2025-09-11; Board of Supervisors final 2025-12-09; Mayor signed 2025-12-12; **effective 2026-01-12**. HCD preliminary approval 2025-09-09. [A] https://sfplanning.org/sf-family-zoning-plan
- Litigation: neighborhood/small-business suits (CEQA, rent control) and pro-housing suit (Feb 2026, Housing Element compliance). [B] https://www.kqed.org/news/12069226 ; https://www.axios.com/local/san-francisco/2026/02/13/pro-housing-groups-sue-family-zoning-plan
- 77% of affected parcels keep height and get density decontrol only; off-corridor ~4 stories (5 near select commercial streets; corners and >8,000 sf lots up to 6); corridors 6–8; high-rise (9+) at nodes (Geary, Van Ness, Market, Lombard). ~92k parcels. [A] https://sfplanning.org/sites/default/files/documents/citywide/FZP-Factsheet-Capacity-Calculations.pdf
- **Local Program "Housing Choice-SF"**: R-4 bulk district only; alternative to State Density Bonus (not both); excludes demolition of >2 rent-controlled units, listed historic, hotels. Administrative approval: no DR, not appealable, 180-day decision deadline when no CEQA document. Major Modification → Planning Commission. Separate ministerial path via the Housing Choice HSD (Planning Code §344): 120 days. [A] https://sfplanning.org/resource/planning-director-bulletin-no-11-housing-choice-sf-program
- RHNA 2023–2031: **82,069** (32,881 low, 13,717 moderate, 35,471 above-moderate). Sites inventory 58,100 + 12,300 buffer → **36,200** shortfall the rezoning had to cover. [A] https://sfplanning.org/sites/default/files/documents/citywide/fzp_land_use_committee_presentation-111725.pdf
- Capacity vs expected buildout (same deck) [A]: **~780,000 units net zoned capacity** added (Local Program). Citywide method: 2005–2023 entitlements 90k of 403k capacity = 22% in 19 yrs (~1%/yr) → 5% in 5 yrs = **39,000**. Soft-sites method **40k (base)–64k (Local Program)**. UrbanSim feasibility **19k–47k**; 221k "feasible" in improved market.
- Controller (Oct 2025): **14,646 units by 2045** (high) / 8,504 (conservative). [B] https://www.kqed.org/news/12062042
- SB 79 (state transit upzoning) applies after 2026-07-01; SF intends FZP as its "Alternative Plan". [A]
- **GIS**: DataSF "Zoning Map – Height and Bulk Districts" `h9wh-cg3m` contains adopted FZP heights as `base//localProgram-R-4` (e.g. `40//65-R-4`), 5,292 polygons, refreshed 2026-10-16. Zoning districts `3i4a-hu95`. Adopted map PDFs `fzp_zoning_map_base_heights.pdf`, `fzp_zoning_map_local_program_heights.pdf`. No "FoglineSF" scrape found.

## 2. Realistic redevelopment rates (denominators differ)

| Figure | Denominator | Source | Conf. |
|---|---|---|---|
| ~1%/yr of capacity entitled (22%/19 yrs) | SF total zoned capacity | FZP deck | A |
| 70% of soft-site capacity in RHNA period (HCD assumption); 2% on parcels with existing units (observed decade rate, SFH lots in 4-unit zoning approved for 2+ net units) | sites | Housing Element App. B pp.42–43 https://sfplanning.org/sites/default/files/documents/citywide/housing-choice/housingchoice_element_appendixB_sites_inventory.pdf | A |
| Blue Sky model: 9,130 probable private units over 8 yrs on non-pipeline parcels | all ~150k parcels | App. B pp.16–18 | A |
| <10% of 5th-cycle Bay Area HE sites developed in-cycle | listed sites | Elmendorf et al., UCLA Lewis https://www.lewis.ucla.edu/research/what-gets-built-on-sites-that-cities-make-available-for-housing/ | B |
| LA HE model: avg parcel 1.49% in 5 yrs | all LA parcels | LA Appendix 4.6 via MetroSight | B |
| SB 9 SF: ~7,000 feasible parcels vs 4 lot-split applications yr 1 | SFH parcels | Terner https://ternercenter.berkeley.edu/research-and-policy/sb-9-turns-one-applications/ | A |
| Auckland: +21,808 dwellings in 5 yrs = 4.1% of stock | regional stock | Greenaway-McGrevy & Phillips, JUE 2023 | A |
| Houston: 0.5% of SFH parcels → townhouses 2007–2020 | SFH parcels | Pew 2023 | B |
| US reforms: +0.8% supply in 3–9 yrs | stock | Stacy, Freemark et al., Urban Studies 2023 | B |
| LA TOC: <560 net additional units over 6 yrs | city stock | Harvard JCHS blog | B |

"15–25%" is not supported as an empirical buildout rate. Closest: 22% of capacity entitled over 19 years.

## 3. Predictors SF uses

- Blue Sky logit (2001–2021): construction cost, prices, zoning category, existing residential/historic, envelope, development potential (allowed ÷ existing). Coefficients in an unextracted image table. [A, App. B]
- Soft-site exclusions [A]: condo; rent-controlled (>4 units pre-1979); city-owned; hospital; individually listed historic; <1,200 sf; capacity <5× existing units; existing building >30% of rezoned capacity; (4-plex rezoning) >1 unit or >1.5 FAR.
- HE unit-yield formula [A]: ≤85': lot × 0.75 × floors × 0.8 ÷ 850 net sf, floors = (height − 15')/10'; >1 acre 0.55 coverage; small-lot towers capped at 12 floors.
- Residential demolitions 6–352 units/yr, 10-yr avg 85 of ~423k units (~0.02%/yr). [A]

## 4. Timelines

- Discretionary entitlement median 24–47 months by pathway (2018–21): discretionary BP 24.2; CU only 35.1; CUA+other 39.7; DA 42.2; **SB 35 3.42**. Average 523 days (2022 APR). [A] https://www.hcd.ca.gov/sites/default/files/docs/policy-and-research/plan-report/sf-housing-policy-and-practice-review.pdf
- Statutory clocks: SB 423 90 days (≤150 units) / 180 days; FZP Local Program 180 days. [A]
- Building permit filed → issued: avg 605 days (2022 APR); 280 days for Jan 2024–Aug 2025 issuances (~740 permits, 3+ review rounds); 114 days for permits filed after Jan 2024; backlog 1,300 permits at avg 1,489 days. [B] https://www.kqed.org/news/12075520
- Permit → construction start: usually within 90 days, up to a year (2025 Housing Inventory). [A] ~80% within 2 months nationally. [B]
- Construction: US 20+ units 21.7 months authorization→completion (2025); West multifamily 20.6. [B] https://eyeonhousing.org/2026/09/shorter-apartment-construction-time-in-2025/ . No SF breakdown by type. [C: Type V/III 18–24 mo, high-rise 30–36]
- Reforms in place: Constraints Reduction Ordinance (2023-12-14); PPA optional since July 2023; SB 423/AB 2011 (80 projects, 7,200+ units, Feb 2026); PermitSF simple permits only. [B]

## 5. Attrition

- Housing Element pipeline conversion (2014-Q4 pipeline units with a building permit by 2022) [A]: PL filed 82%; PL approved 66%; BP filed/awaiting first construction document 70%.
- Pipeline 2026-Q2 [A] https://sfplanning.org/sites/default/files/documents/reports/Housing_Production_Development_Pipeline-2026Q2.pdf : total 75,853 units; under construction 3,327; site permit issued 1,512; BP approved 2,419; BP filed 7,074; **BP not yet filed 9,659** (448 five years ago); remaining phases of multi-phase projects 37,785; under review 14,104. ~58k entitled not under construction.
- No published elasticity of attrition to interest rates.

## 6. Market 2024–2026

| Year | Authorized | Completed | Net added |
|---|---|---|---|
| 2023 | 2,997 | 2,059 | 2,544 |
| 2024 | 1,031 | 1,457 | 1,603 |
| 2025 | 1,900 | 2,406 | 2,669 |

Source: 2025 Housing Inventory Table 2 [A] https://sfplanning.org/sites/default/files/resources/2026-04/2025_Housing_Inventory.pdf . 2025 Planning filings 9,614 units (2024: 2,517), approvals 3,723. H1 2026 completions 405 [B, Frisc 2026-07-08]. Controller triennial feasibility (2026-04-30): apartment residual land value negative for every prototype (−$96k to −$363k/unit) even with no inclusionary; 85' condo with no inclusionary borderline +$60k. [A] https://media.api.sf.gov/documents/Triennial_Economic_Feasibilty_Report_2026.final.pdf

## 7. Stage table (literature only)

| Stage | Duration | Survival to next | Conf. |
|---|---|---|---|
| (optional PPA) → filed | 0–12 mo | not published | B |
| Filed → entitled | discretionary 24–40 mo; SB 35 3.4; SB 423/Local Program ≤3–6 | no cohort figure; 82% of filed units eventually reached permit | A |
| Entitled → BP filed | not published | 66% of approved units reached permit in ~7 yrs | A |
| BP filed → site permit issued | 280 d (2024–25); 114 d new filings | ~70% (pre-2022) | A/B |
| Site permit → start | 0–12 mo, typ. <3 | not published | B |
| Start → TCO/CFC | ~22 mo (US) | not published; ~100% assumed | C |

## 8. Project resizing

No systematic statistic found. 2025: 1,673 revision units filed, 1,216 approved [A, Housing Inventory]. >Half of 10+ unit projects 2018–21 used a density bonus, avg >30% [A]. SDB pipeline 93 projects, 17,554 units [A]. 2026 changes mostly upward after entitlement via AB 1287 / FZP re-applications (One Oak 319→541; Thompson Builders 127→272; West Portal height doubled to 172 units; Marina towers lowered but more units) [B]. No documented downsizing cases found.
