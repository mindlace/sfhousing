# Ruling finite-funding-1
Package commit: a552b3a5
Changes design: yes
Changes contract: no
## Ruling
(a) The impact-fee bound is `remaining`, $45,158,744, tier 2. The primary is MOHCD's FY2024-25 Annual Report, Table 2 "Affordable Housing Fund Summary", p. 21: the ending balances at 30 June 2025 of the Inclusionary Affordable Housing Fee account (Planning Code sections 415 and 419), $28,865,155, and the Jobs-Housing Linkage Fee account (section 413), $16,293,589, net of loan encumbrances. The spec's rule is "when a primary states the balance, the bound is a `remaining`"; the report the balance is read from is a means, and a recorded balance from the department that holds the accounts is that primary. The `none` fallback is gone from the spec: the balance was found. Spending between 30 June 2025 and the dataset date is not subtracted and later collections are not added; the method says so. The pool receives $34.8 million on the dataset date and $10,358,744 on the first anniversary. The first-year check stays 780 implied against 980 observed with no warning. Reach: this lies between the measured F-2y and F-0 variants (Jul 2065 and Apr 2065 with closing), so D1 is expected to hold; `reach-check` judges it on the built dataset.

(b) PASS is out. The `city-debt` bound stays $260,310,000, the unissued part of 2019 and 2024 Proposition A. Row [2], the 2016 PASS programme ($47,464,550 unissued), lends from the 1992 Seismic Safety Loan Program authorisation to preserve existing buildings; it adds no new homes, which is what the pool funds. The bound's method and the section's text name row [2] as not counted.

(c) No change in this build. The data states the law as read: the Housing Trust Fund ends 2043-06-30, and its method says the 2026 extension "was not certified when this was read and is a measure a player adds". The state source stays `none`. Certification of either measure is taken in by the yearly update of `funding.json` (finance-data.md, "Updating funding.json"), a later change that no unit of this build makes; certifying the HTF extension would only lengthen a source, which cannot move D1 the wrong way.

Also made true to the builder's primary read: `city-ocoh`'s cite page is "p. 44". The spec's tests pin the impact-fee row as the `remaining` block, and the handback no longer reports a chosen impact-fee block.
## Re-read
- docs/superpowers/specs/2026-11-22-finite-funding-design.html § sec-design-data (tbl-ff-bounds), sec-design-data-city-debt, sec-design-data-ocoh, sec-design-data-impact-fees, sec-design-data-htf, sec-design-provenance (the check), sec-design-reach, sec-tests-pipeline, sec-docs
## Affected units
- finite-funding: clarification
## Build graph
- finite-funding
