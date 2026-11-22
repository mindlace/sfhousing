# Research note: what bounds each of today's funding sources

Investigator agent, 2026-11-22. Read-only. "Primary" means the agent read it in the primary source; nothing here has been re-read by the composer, so every row is testimony until the `finite-funding` builder reads the primary. BLA = Budget and Legislative Analyst, "Funding and Incentivizing Affordable Housing in San Francisco", 2026-06-05, https://media.api.sf.gov/documents/BLA_Financing_Affordable_Housing_060526.pdf.

## The repo today

- `pipeline/enrichment/funding.json` City sources (id | kind | dollars a year): `city-debt` goBond 80,500,000; `city-ocoh` dedicatedTax 48,600,000; `city-general-fund` generalRevenue 36,700,000; `city-impact-fees` dedicatedTax 34,800,000; `city-housing-trust-fund` generalRevenue 27,400,000; `city-redevelopment` dedicatedTax 6,000,000. City entries carry a `note`, not a `method`; `state` and `federal` carry `method`.
- Notes already in the file that bear on bounds: `city-general-fund` includes $14.9M Housing Stability Fund (Prop I, 2020) "spent down by February 2026"; `city-impact-fees` spending was "from prior year fee collections and loan repayments", FY2024-25 fee revenue $422,048 against an $18.0M average; `city-housing-trust-fund` "running to 2043"; `city-redevelopment` "that source has now been spent down" (BLA p. 73); `city-debt` future bonds "will require periodic City authorization and voter approval" (BLA p. 72).
- `pipeline/lib/fzp-cal/funding.ts:209-232`: every capped pool is `yearly { from: asOf, to: null }`; `:242-251`: the federal pool has `inflows: []`, `uncapped: true`.
- `awards` table, new construction only: 2024 = 1,274 homes (ten projects: 1,239 at 4%, 35 at 9%); 2025 = 686 homes (five projects, all 4%).

## Findings

| Source | What bounds it | Date or amount | Where read | Confidence |
|---|---|---|---|---|
| GO bond, 2015 Prop A | Fully issued | $310M authorised, $0 unissued | sf.gov GO Bonds Project Summary, 30 Sep 2026, row [10] (media.api.sf.gov/documents/08c._GOB_Project_Summary_2027_September_2026.pdf) | Primary |
| GO bond, 2019 Prop A | Unissued balance | $600M authorised, $492.46M issued, $107.54M unissued; Series 2026D about $107.5M, estimated close 5 Nov 2026 | Project Summary row [13]; Controller's Forward Debt Calendar, 19 Oct 2026 | Primary; sale close not confirmed |
| GO bond, 2024 Prop A | Unissued balance | $300M authorised, $147.23M issued (Jan 2025), $152.77M unissued; Series 2026E about $45.3M, estimated close 5 Nov 2026 | Project Summary row [16]; Forward Debt Calendar; 2024 bond report (CGOBOC), Jun 2026, p. 6 | Primary; the Nov 2026 sale is an estimate |
| Next housing GO bond | The capital plan's next housing bond | Nov 2034, $200M | Amended FY26-35 Capital Plan, Table 1.5 (archive.sf.gov copy) | Primary |
| GO bond policy ceiling | Property tax rate held at or below the 2006 rate; approached about FY2031-32 | 0.1201% of assessed value | BLA pp. 104-105 | Primary |
| Our City, Our Home (2018 Prop C) | At least 50% to permanent housing; "a continuing fund"; sunset not found | $331M spent in FY25 across all areas | sf.gov "About Our City Our Home Fund"; BLA pp. 44, 46 | Share primary; sunset not found |
| General Fund | Nothing fixed in law beyond the Housing Trust Fund; from "unrestricted tax revenues"; the Prop I piece spent down by Feb 2026 | n/a | BLA pp. 44, 100 | BLA primary; "no other mandate" inferred |
| Impact fees | Depend on development; collections tiny | FY24-25 collections $422,048; FY24-25 spending $34.8M from prior-year balances and loan repayments; no end date found | BLA pp. 9, 44, 55 | Primary |
| Housing Trust Fund (2012 Prop C) | Expires 2043 (FY2042-43) | About $52M a year now. 2026 Prop C (passed 3 Nov 2026, not certified as of 18 Nov): extends to 2058, grows from 2028 to $125M (expected FY2034-35), then at most 3% a year | Controller's Prop C letter, 10 Aug 2026; Ballot Simplification Committee digest, 30 Jul 2026; BLA pp. 21, 108; KQED 18 Nov 2026 (Yes 81.8%) | Primary; result not certified |
| Former Redevelopment housing assets | The old fund is spent down; OCII limited to enforceable obligations; SB 593 bond route for 5,842 replacement homes | BLA projection of net City share after SB 593 debt service: $76.6M in FY26-27, $504.2M over FY26-27 to FY36-37 | BLA pp. 73, 96-97 (Exhibit 36) | Primary; end of obligations not found |
| State programmes (MHP, AHSC, IIG, CalHFA) | "More than $1.2B since 2018"; exhaustion of 2018 Prop 1 not found | 2026 Prop 1 (passed 3 Nov 2026, not certified): $11.25B, $7.2B multifamily; no San Francisco share stated | Legislative Analyst, Prop 1 analysis; BLA p. 42 | Primary for the bond |
| AHSC | Cap-and-invest fund; 2026-27 plan $105M statewide; revenue falling | The "through 2045" claim only in secondary snippets | Legislative Analyst, "GGRF Updates", 12 Aug 2026 | Primary for $105M; 2045 secondary |
| Federal 9% credit | California's yearly ceiling | 2026: $136.4M statewide; San Francisco regional share $2,861,626 federal credit a year | CTCAC allocation estimate for 2026, updated 2 Sep 2026 | Primary |
| Federal 4% credit | California's private-activity bond ceiling; no San Francisco share | 2026: $4.829B for rental housing with carryforward; Bay Area row $367.4M a year | CDLAC Exhibit A, 14 Sep 2026 | Primary |
| 2025 federal law | Bond-financing test lowered from 50% to 25% | 4% credits roughly double per bond dollar | BLA p. 46 | BLA is secondary for the law |

## Not verified

- The Our City, Our Home sunset year (the 2018 measure's text was not found).
- Whether 2018 Prop 1 and Prop 2 money is exhausted.
- The end date of the OCII obligations; the Housing Trust Fund's last fiscal year in the Charter text itself.
- The 2045 end date for cap-and-invest.
- The 2025 federal changes in the statute or IRS text.
- Whether the Nov 2026 bond sales closed; certification of local Prop C and state Prop 1.
- `docs/dev/sim-funding.md` calls state Prop 1 "unavailable / not used" and the Housing Trust Fund measure "not yet certified (passed on early counts)": both now have later counts.
