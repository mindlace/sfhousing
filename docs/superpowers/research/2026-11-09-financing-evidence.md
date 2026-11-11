# Financing evidence digest (2026-11-09)

Research for the `sim-financing` composition ([design](../design/2026-11-09-1911-sim-financing.md)). It condenses seven research reports and the orchestrator's own checks. Evidence tiers: 0 per-record data, 1 official aggregate or law, 2 inference, 3 literature or model, 4 invented.

Each item is marked:

- **[V]** read in the primary document by the orchestrator;
- **[R]** reported by a research agent that read the primary document; re-read it before a spec or a constant rests on it;
- **[S]** seen only in a secondary source or a search snippet; do not use without the primary.

All accessed 2026-11-09.

## 1. Our own records

- **[V] The start model's hold-out** (`calibration-report.md`, section 5, dataset `2026-11-04-bbb2eba1`; tier 0). Fitted through 2022, the initiation model predicts 386.4 starts for 2023–2025 (128.2, 128.7, 129.6); 129 were observed (33, 40, 56). ln(129 ÷ 386.4) = −1.10.
- **[V] The published model on the same years** (same report, section 5, "Plausibility"; tier 0). The published hazard, fitted on 2007–2025, implies 245.5 starts for 2023–2025 (81.6, 81.7, 82.2) against the same 129 observed. ln(129 ÷ 245.5) = −0.64. This is the level the design applies (OD-F11), because the engine runs the published model; the hold-out figure above is evidence of the cycle only.
- **[V] Observed against published hazard by year** (same report, "Plausibility"): 2007 89 / 57.4; 2008 53 / 58.0; 2009 29 / 58.4; 2010 38 / 58.6; 2011 24 / 59.6; 2012 45 / 60.1; 2013 76 / 59.6; 2014 108 / 58.4; 2015 145 / 58.3; 2016 134 / 58.7; 2017 77 / 58.4; 2018 71 / 58.3; 2019 96 / 60.3; 2020 51 / 60.1; 2021 53 / 60.0; 2022 53 / 60.5; 2023 33 / 81.6; 2024 40 / 81.7; 2025 56 / 82.2. Events 1,271 (720 by first Planning record from 2015, 551 by permit filing before).
- **[V] Eventual completion and drop-out** (live `calibration.json`, dataset `2026-11-08-d15bdf2d`, `eventualProbabilities`): share of filed projects reaching completion 60.7% discretionary, 68.3% streamlined, 67.7% permit-only. Discretionary eventual exit by stage: filed 8.2%, entitled 2.4%, permitFiled 10.3%, permitIssued 14.1%, construction 12.1%.
- **[V] In flight** (live `projects.json`): 72 filed (8,104 net homes), 75 entitled (41,932), 159 permitFiled (10,990), 59 permitIssued (1,996), 60 construction (2,685). `rhnaCompletedNet` 8,709.
- **[V] 100% affordable projects against the rest** (orchestrator tabulation: `project-histories.json` of build `2026-11-04-bbb2eba1` joined to the locked Planning-project pages by `record_id`; projects of 10+ homes, first record 2015 or later; no censoring method; tier 0, small n):

  | | ≥ 95% affordable (n = 54) | Some affordable (n = 189) | None (n = 67) |
  | --- | --- | --- | --- |
  | Pathway: streamlined / discretionary / permit-only / unknown | 36 / 16 / 1 / 1 | 22 / 153 / 4 / 10 | 2 / 60 / 2 / 3 |
  | Ended: complete / exited / open | 23 / 8 / 23 | 17 / 48 / 124 | 16 / 17 / 34 |
  | Exits of resolved, filed | 5 of 52 | 32 of 147 | 12 of 61 |
  | Exits of resolved, entitled | 1 of 40 | 6 of 84 | 0 of 37 |
  | Exits of resolved, permitFiled | 1 of 37 | 4 of 42 | 4 of 26 |
  | Exits of resolved, permitIssued | 0 of 31 | 3 of 26 | 1 of 20 |
  | Exits of resolved, construction | 1 of 24 | 3 of 20 | 0 of 16 |
  | Median months, filed to next stage | 8.3 | 31.5 | 27.9 |
  | Median months, construction to completion | 22.5 | 24.9 | 20.0 |

- **[R] Fields the pipeline fetches and ships nowhere** (`pipeline/sources/datasf.ts`; the `$select` lines verified [V] at 80, 93, 103, 175–176): `number_affordable_units_prop` (qvu5-m3a2; kept as `Prj.affordableProp`, used only in `lapse.ts:189`); `estimated_cost`, `revised_cost` (i98e-djp9; `Permit.valuation`); `assessed_land_value`, `assessed_improvement_value` (wv5m-vpq2; shipped only as `improvementShare`). `xdht-4php` (housing production) is fetched with five columns; the dataset also has income-tier unit columns [R].

## 2. Feasibility of private projects

Source: San Francisco Controller, *Inclusionary Housing: Triennial Review of Economic Feasibility, 2026*, 2026-04-30 (corrected 2026-05-19). https://media.api.sf.gov/documents/Triennial_Economic_Feasibilty_Report_2026.final.pdf . Tier 1.

- **[V] p. 3**: one market land sale since 2023, at $68,000 a home, "within the previously estimated land cost per unit range of $60,000 - $70,000". Apartments are "not projected to be financially feasible, even if land costs were zero".
- **[V] p. 4, residual land value per home, apartments** (cases A, B, C, D, E):

  | Scenario | A lowrise | B midrise | C highrise | D highrise | E lowrise |
  | --- | --- | --- | --- | --- | --- |
  | Base, current projects | −177,000 | −152,000 | −206,000 | −292,000 | −353,000 |
  | Base, pipeline projects | −166,000 | −138,000 | −192,000 | −281,000 | −353,000 |
  | Base, interim projects | −173,000 | −148,000 | −206,000 | −292,000 | −353,000 |
  | State Density Bonus, interim | −155,000 | −204,000 | −210,000 | −298,000 | −280,000 |
  | Base, in-lieu fee | −187,000 | −152,000 | −201,000 | −294,000 | −363,000 |
  | Hypothetical 100% market rate | −131,000 | −96,000 | −144,000 | −236,000 | −308,000 |

  "Current" is "the requirements that will apply, absent legislative action, on November 1, 2026" (footnote 2). Condominiums, same page: current −164,000, −42,000, −184,000, −269,000, −249,000; 100% market rate −100,000, +60,000, −80,000, −170,000, −201,000.
- **[V] p. 11, underwriting, for-rent apartments, base programme**:

  | | A | B | C | D | E |
  | --- | --- | --- | --- | --- | --- |
  | Construction type | V | III | I | I | V |
  | Stories / height | 5 / 55 ft | 8 / 85 ft | 13 / 135 ft | 24 / 245 ft | 4 / 45 ft |
  | Gross square feet | 53,031 | 151,438 | 265,469 | 402,807 | 19,281 |
  | Homes | 45 | 130 | 227 | 341 | 13 |
  | Market rent (per month / per sq ft) | $4,299 / $5.22 | $4,664 / $5.65 | $5,203 / $6.31 | $5,053 / $6.12 | $4,238 / $5.04 |
  | Hard cost per home | $600,200 | $613,200 | $716,800 | $771,500 | $754,600 |
  | Impact fees per home | $18,900 | $18,400 | $18,700 | $18,800 | $28,600 |
  | Other soft costs per home | $110,800 | $105,300 | $122,300 | $128,300 | $176,500 |
  | Total cost per home (no land) | $729,700 | $736,700 | $857,700 | $918,700 | $929,700 |
  | Untrended annual net operating income | $1,501,500 | $4,568,900 | $8,886,600 | $12,837,256 | $482,592 |
  | Untrended return on cost | 6.00% | 6.00% | 6.00% | 6.00% | 6.00% |

- **[V, arithmetic]** Net income ÷ homes ÷ 0.06 − cost per home gives −173,600 (A), −150,900 (B), −205,200 (C), −291,300 (D), −311,000 (E). A to D reproduce the published values within $3,000; **E does not** (published −353,000), so use the published residual land values, not the identity, for the shortfall.
- **[R]** Efficiency 80% (78% for D); average home 825 net sq ft (852 for E); a Feb 2026 draft used a 5.25% return on cost and gave 100% market-rate apartment values of −51k, −10k, −52k, −120k, −204k (TAC meeting 2 deck, slides 14–20; https://media.api.sf.gov/documents/TAC_Meeting_2_Presentation_-_2-11-2026.pdf), so the move from 5.25% to 6.00% is a published sensitivity of about $46k–$83k a home.
- **[R]** Inclusionary rules (pp. 7–8): rental of 25+ homes 18% on site, split 10 / 4 / 4 at 55% / 80% / 110% of area median income; 10–24 homes 15% at 55%; condominiums 20% on site.
- **[V]** Budget Analyst (section 4 below), Exhibit J, on-site rates for rental: pre-2023 15% (10–24 homes) and 22% (25+); pipeline projects 12% and 12%; interim projects 15% and 15%; future projects 15% and 18%, the 25+ rate rising 0.5 points a year from 2028-01-01 to 24%.
- **[R]** Terner Center, *Making It Pencil*, Dec 2023 (not SF: East Bay and South Bay prototypes; tier 3): construction loan 8.5%, permanent loan 6%, loan-to-cost fell from 65% to 55%, required return on cost 1.0–1.5 points over the cap rate. https://ternercenter.berkeley.edu/wp-content/uploads/2023/12/Making-It-Pencil-December-2023.pdf

## 3. The Controller's development model and market scenarios

Source: Controller, Office of Economic Analysis, *Family Zoning Plan: Economic Impact Report*, File 250700, October 2025. https://newspack-missionlocal.s3.amazonaws.com/mission/wp-content/uploads/2025/10/250700_economic_impact_final.pdf . Tier 3 (a model on tier 0 data).

- **[V] slides 28–32**: a parcel-year logit over 2004–2024 on "the parcel produced housing in a given year", parcels under development agreements excluded; 3,369,573 parcel-years, 422 events [R]. Coefficients: intercept −1.6226; `Construc_Cost_Real` −0.0992 (SE 0.0129); `Zillow_Price_Real` +0.0143 (SE 0.0053); `SDB_2016_5Plus` +0.6303; height per foot +0.0017; residential existing use −0.8231; historic −1.0378. Cost is a 60/40 blend of real construction-materials PPI and real San Francisco metro construction wages, 2016 = 100, lagged two years; price is Zillow's real condo index for ten neighbourhoods, 2016 = 100, lagged two years.
- **[V] slides 12–16**: two scenarios for 2026–2045. Low growth: post-COVID prices are a "new normal" and grow 1.8% a year in real terms. High growth: prices return to their pre-COVID level relative to the U.S. by 2030, then grow at the long-term rate. Construction cost grows at 0% real in both. Chart readings (approximate): price index about 77 in 2025, 100 in 2016, about 64 in 2011–2012, about 85 in 2006–2007; blended cost index about 112–113 in 2023–2024, about 117 in 2021–2022, 100 in 2016, about 97–98 in 2009–2014.
- **[V] slide 18**: the rezoning adds 8,504 homes (low growth) and 14,646 (high growth) over 20 years. This is the primary source for the two references `score.ts` cites through KQED.
- **[V, arithmetic, approximate]** On chart-read means of the lagged indices over 2005–2023 (cost about 101.7, price about 85.8), today's values give −0.0992 × 10.8 + 0.0143 × (−8.8) ≈ −1.2 log-odds.
- **[R] Weakness** (research agent's caveat, which the orchestrator shares): the indices vary only by year, so about 20 yearly values carry the cost and price terms and the parcel-year standard errors overstate precision; the implied cost elasticity (about −10) and price elasticity (about +1.4) differ seven-fold.

## 4. What affordable homes cost, and the City's money

Source: San Francisco Budget and Legislative Analyst, *Funding and Incentivizing Affordable Housing in San Francisco* (report to Supervisor Chen), 2026-06-05, 132 pp. https://media.api.sf.gov/documents/BLA_Financing_Affordable_Housing_060526.pdf . Tier 1.

- **[V] Exhibit E, p. 6**: MOHCD spending on multifamily grants and loans from local sources, FY2024-25, $234 million: general-obligation bond and other debt $80.5M; Our City, Our Home $48.6M; General Fund $36.7M; impact fees $34.8M; Housing Trust Fund $27.4M; former redevelopment agency assets $6M.
- **[V] Exhibit F, p. 7**: average funding per home in projects using tax credits, 2024: $954,127. City and County $300,027 (32%); federal $443,108 (46%); state $118,390 (13%); permanent loans $87,431 (8%); other $5,171 (1%).
- **[V] Exhibit I, p. 9**: affordable-housing impact fees averaged $18.0M a year over FY2017-18 to FY2024-25, falling to $0.4M in FY2024-25.
- **[R] Exhibit D, p. 5**: RHNA 2023–2031 targets and progress through 2025: very low 20,867 (2,981); low 12,014 (1,682); moderate 13,717 (1,402); above moderate 35,471 (3,516); total 82,069 (9,581).
- **[R] Exhibit O / 29, pp. 16, 72**: MOHCD subsidy estimates of $405k (very low), $450k (low), $490k (moderate) a home against an average total cost of $900k; the remaining affordable RHNA need would take $17.9 billion.
- **[R] pp. 21, 104–106**: Charter limit on general-obligation debt 3% of assessed value (about $10.6B on $353.6B); outstanding with anticipated issuance about $2.67B at Dec 2025. Capital Plan policy holds the bond property-tax rate at its FY2006 level, 0.1201%; FY2025-26 rate 0.1105%; the 2006 rate is reached about FY2031-32. Raising the rate by 0.01 point supports about $410M of principal at 6% over 20 years ($35.8M a year, $715.7M total; about $75.49 a year for a median single-family owner). $715.7M ÷ $410.4M = $1.74 repaid per $1 (tier 2 arithmetic).
- **[R] pp. 107–108**: certificates of participation are capped at 3.25% of discretionary revenue ($151.45M a year of debt service; $1.669B of principal capacity), binding about FY2028-29; BLA assumes 6.5% over 20 years and issuance costs of 15–25%.
- **[R] pp. 99–101, 109**: the 2020 transfer-tax measure raised $324M from Jan 2021 to Mar 2024; the Housing Trust Fund is about $50–52M a year.
- **[R] p. 42**: state HCD programmes "have provided more than $1.2 billion" to San Francisco since 2018.
- **[R] pp. 77–79**: PASS (preservation loans; $260.7M authority, $174M disbursed since 2019; blended rates 2.57%–5.61%; 40 years; preservation only). Montgomery County Housing Production Fund: $100M ($50M in 2021, $50M in 2022), the county pays $3.4M a year for 20 years, five-year construction loans, at least 30% affordable; 268 homes completed, about 2,900 in the pipeline; no completed revolve reported.
- **[R]** Outstanding general-obligation principal at 2026-06-30: $2,361,113,671 (Controller, *Outstanding Long-Term Obligations as of 6/30/26*, p. 1; tier 0). https://media.api.sf.gov/documents/CCSF_Outstanding_LT_Debt_as_of_6.30.26.pdf
- **[R]** Housing bonds (MOHCD presentation to the bond oversight committee, 2026-02-09; https://media.api.sf.gov/documents/04._MOHCD_CGOBOC_Presentation_Feb_2026.pdf): 2015 $310M (fully issued); 2019 $600M (3,365 homes projected: 1,795 complete, 634 in construction, 936 in predevelopment; $108.8M unissued); 2024 $300M (1,040 projected: 512 in construction, 528 in predevelopment).
- **[R]** November 2026 Proposition C (Housing Trust Fund): raises the fund to $125M a year by FY2034-35 against about $65M under current law, +$6M in FY2028-29 rising to +$60M a year, extended to 2058 (Controller's statement, 2026-08-10; https://media.api.sf.gov/documents/Proposition_C__Contributions_to_the_Housing_Fund_-_Signed.pdf). About 80% yes on early counts, **not certified**.
- **[R]** Budget and Legislative Analyst, *Performance Audit of Affordable Housing Financing*, 2023-04-04 (https://sfbos.archive.sf.gov/sites/default/files/Performance_Audit_Of_Affordable_Housing_Financing_4_4_23.pdf): local subsidy per multifamily rental home completed FY2017-18 to FY2021-22 $175,443 (2,491 homes, $437.0M); MOHCD multifamily spending $128.4M, $152.6M, $286.7M, $202.6M, $184.0M over those years; local fund balances averaged $482M; 7 of 29 projects slipped a year or more.
- **[R] 100% affordable homes completed by year** (Housing Inventory 2020 Table 25 and 2025 Table 24; tier 1): 2016 288; 2017 946; 2018 341; 2019 874; 2020 208; 2021 986; 2022 728; 2023 585; 2024 820; 2025 1,440 (mean about 722). https://sfplanning.org/sites/default/files/resources/2026-04/2025_Housing_Inventory.pdf
- **[R] Open data** (data.sf.gov): `aaxw-2cb8`, MOHCD affordable housing pipeline, PDDL, 190 rows, stage dates, total and affordable homes, income bands from 20% to 150% of area median income, no dollar fields; `pyxv-n29e`, MOHCD portfolio, no licence field; `xdht-4php`, housing production with income-tier columns (already locked, five columns selected). No open dataset gives City funding per project.

## 5. The proposed public bank

Sources: Reinvestment Working Group / HR&A Advisors, *Municipal Finance Corporation Business and Governance Plan and Viability Study*, 2023-05-10 (https://lafco.archive.sf.gov/sites/default/files/rwg051823_MFC-Final.pdf) and *San Francisco Public Bank Business and Governance Plan and Viability Study*, 2023 (https://lafco.archive.sf.gov/sites/default/files/rwg051823_PublicBankFinal.pdf). Tier 3 (a consultant's projection). All **[R]**.

- Municipal finance corporation, years 1–3: City capital $20M + $10M + $10M; appropriated funding $6M, $24M, $20M; gross loans at year end $20.0M, $41.0M, $59.9M; new loans $20.0M, $24.0M, $27.1M (about $71M); affordable-housing and community-lender loans at 6.13%; 10% of lending direct to affordable housing, 10% small business, 10% green, 70% through community lenders; loss allowance 2.5% of loans; break-even in year 3.
- Bank under AB 857 from year 4: a further $20M of capital (about $60M in all) and funding rising to $250M by its fifth year; gross loans $111M, $154M, $191M, $227M, $253M; **no deposits** in the base case ("unlikely … until the Bank receives a credit rating, which may not happen until Year 6 or later"); housing rate 5.78%, falling to 5.03% on new loans; legal lending limit about $5M unsecured, $10M secured.
- Loans per City dollar (tier 2 arithmetic): 0.67 at year 3; 0.82 at the bank's fifth year.
- Neither plan gives loan-to-cost, loan size, term, product mix or homes financed.
- The Budget Analyst's "about $120 million of loans in three years" equals the sum of the three year-end balances.
- AB 857 (Gov. Code §57600 et seq.): at most 2 licences a year and 10 in total; no licence more than seven years after the regulations took effect.
- November 2026 Proposition B (charter amendment authorising both, "subject to the availability of adequate funding"; no appropriation): leading, **not certified**. The Controller's cost estimate of $310M–$460M over eight years is **[S]**.
- FDIC net charge-off rates, all insured institutions (Quarterly Banking Profile, Table V-A; tier 1): construction and development 5.40% (2009), 5.45% (2010), −0.01% (2019); multifamily 1.11%, 1.24%, 0.00%.

## 6. State and federal money

All **[R]** unless marked.

- **What binds.** San Francisco's 9% credit apportionment is 3.7% of the regional balance (CTCAC Reg. §10315; $2.86M federal a year in 2026); 2026 round 1 had "no recommended projects" in the region. The Bay Area bond pool used $75.2M of $128.6M in 2026 round 1 and $170.1M of $181.9M in round 2 (https://www.treasurer.ca.gov/sites/default/files/2026-09/Allocation_by_Round_9-14-2026.pdf). Statewide, bond demand was 2.58 times the cap in 2021 **[S]**.
  - **[V] on 2026-11-10** (reappraisal 1), each figure above except the 2021 one: the bond table is the Debt Limit Allocation Committee's Exhibit A, updated 2026-09-14 (Bay Area Region 21%, $367,379,061 a year; QRRP ceiling $4,829,170,308; no San Francisco line); the 9% figures are in the Tax Credit Allocation Committee's 2026 credit estimates, updated 2026-09-02, Step 3 (San Francisco County 3.7%, $2,861,626 annual federal credit, $3,437,486 available in round 1, $0 awarded: https://www.treasurer.ca.gov/sites/default/files/2026-03/2026-credit-estimates.pdf) and its round 1 final recommendations of 2026-06-22 (https://www.treasurer.ca.gov/sites/default/files/ctcac/2026_R1_Final_Recommendations.pdf). The regulation itself was not read.
- **San Francisco bond and 4% credit awards** (CDLAC award lists; tier 0): 2024 10 projects, 1,302 homes (9 new-construction projects, 1,239 homes), $550.0M of bond cap, $47.3M of annual federal credit; 2025 6 projects, 758 homes (5 / 686), $279.7M, $26.0M; 2026 rounds 1–2 6 projects, 845 homes (5 / 742), $216.7M, $38.9M. Bond cap per home fell from $422k (2024) to $256k (2026).
- **Equity** (staff reports in the CDLAC binders; tier 0): federal credit price $0.837–$0.914; permanent tax-credit equity $329k–$549k a home in 100% affordable new buildings (31–59% of cost); total cost $819k–$1.20M a home.
- **Federal changes**: the 9% per-capita amount rose from $3.00 to $3.416 for 2026 (+12%, permanent); the bond test fell from 50% to 25% for bonds issued after 2025-12-31 (P.L. 119-21, 2025-07-04; the statute itself not read). The 21st Century ROAD to Housing Act became law in July 2026; it authorises an innovation fund of $200M a year for FY2027–31 and appropriates nothing. HOME: FY2026 $1,250M nationally; FY2027 President $0, House committee $500M; San Francisco's HOME allocation is $4.25M (2026-27).
- **State**: about $150M a year to San Francisco on average 2018–2025 (tier 2 from the Budget Analyst's "$1.2 billion"); per home $160k–$226k where awarded (for example $226k at Casa Adelante), nothing in many projects; the 2026 MHP gap awards (19 projects, $233.4M, 1,590 homes) had none in San Francisco. State low-income housing credit $500M in 2026-27; MHP $200M.
- **November 2026 Proposition 1** (SB 417): $11.25B, of which $7.2B for affordable multifamily rental, "up to 40,000 multifamily rental units" (Legislative Analyst; https://lao.ca.gov/BallotAnalysis/Proposition?number=1&year=2026). About 59% yes on early counts, **not certified**. San Francisco's share is not published.
- **Regional**: the Bay Area Housing Finance Authority's $20B bond was withdrawn in 2024 (about $2.4B for San Francisco); a 2028 measure is being shaped.

## 7. Does public money get housing built? (ruling R8)

All **[R]**; tier 3 unless marked.

- **Displacement of unsubsidised building.**
  - Soltas, "Tax Incentives and the Supply of Low-Income Housing", working paper, 2024-05-11: 22,241 applications in 453 competitions, 40 states, 2005–2019; of every ten tax-credit homes "about eight units displace private housing that would have otherwise been built within ten years"; 75% of losing applicant parcels are developed within ten years anyway; about $1 million of federal cost per net new home; a 10% cut in the net cost of development raises applications by at least 3%. https://economics.sas.upenn.edu/system/files/2024-08/Empirical%20Micro%2010312024.pdf
  - Ferreira, Meyer and Turner, "The Effect of LIHTC on Housing Markets", NBER Summer Institute slides, 2026-07-29: 89 homes allocated, 87 placed in service, 77 net multifamily homes in the block group: 11.5% crowd-out (95% CI −6% to 28%), local only. https://conference.nber.org/conf_papers/f240610/f240610.slides.pdf
  - Eriksen and Rosenthal 2010: 15% (OLS) to nearly 100% (IV). Sinai and Waldfogel 2005: 50–67% displaced, less in more populous markets. Baum-Snow and Marion 2009: about 20%, concentrated in gentrifying tracts. (Abstracts and secondary summaries only.)
  - No estimate exists for San Francisco or for supply-constrained coastal markets.
- **Cost and starts.** Saiz 2010 (QJE, Table VI): price elasticity of housing supply 0.66 for San Francisco. Inclusionary and fee studies (Bento et al. 2009; Schuetz, Meltzer and Been 2011; Hamilton 2021; Burge and Ihlanfeldt 2006) find small or no effects on starts; none gives a percent-per-percent elasticity.
- **Interest rates, loans, guarantees.** No measured elasticity of multifamily starts to rates was found, and no evaluation of any public loan, guarantee or revolving fund.
- **Completion.** 87 of 89 awarded tax-credit homes placed in service (Ferreira, Meyer and Turner). Terner Center 2025 (699 California tax-credit projects, 2020–2023): each further public funding source adds 3.87 months and $20,460 a home; projects that fail a first credit application wait 17 months on average. https://ternercenter.berkeley.edu/?p=5311
- **San Francisco series.** No published relationship between City spending and homes built; five fiscal years of spending overlap ten calendar years of completions (section 4).

## 8. Gaps

- No loss or repayment record for any City loan programme; no loss figure for a single abandoned project.
- No San Francisco ceiling on bond allocation: the state's ceiling is divided among state-wide pools and regions, and San Francisco is in the Bay Area region. (Corrected on 2026-11-10: the 9% credit does have a San Francisco share, a geographic apportionment of $2,861,626 a year in 2026; see section 6.)
- No loan terms in the public-bank plans.
- No San Francisco share of the 2026 state bond.
- Certification of the three November 2026 measures (Housing Trust Fund, public bank, state bond).
- The statute text behind the 2025 federal credit changes, and CTCAC annual reports for 2022–2025 (the site moved).

## Where to read the primaries

The spec writers read the three reports from copies in a session scratch directory that no longer exists. A builder who needs a page fetches the report from its source:

- The Controller's 2026 Triennial feasibility review: <https://media.api.sf.gov/documents/Triennial_Economic_Feasibilty_Report_2026.final.pdf>
- The Controller's Family Zoning Plan economic impact report (File 250700): <https://newspack-missionlocal.s3.amazonaws.com/mission/wp-content/uploads/2025/10/250700_economic_impact_final.pdf> (a hosted copy; the `market-baseline` spec's open question covers the official address)
- The Budget and Legislative Analyst's June 2026 report: <https://media.api.sf.gov/documents/BLA_Financing_Affordable_Housing_060526.pdf>

The calibration figures quoted above come from the calibration report of dataset build `2026-11-04-bbb2eba1` and the published `calibration.json` and `projects.json` of dataset `2026-11-08-d15bdf2d`. `npm run pipeline -- build` writes a current report under `pipeline/.cache/derived/<version>/calibration-report.md`.
