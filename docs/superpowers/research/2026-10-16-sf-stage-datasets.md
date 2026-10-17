# SF housing stage-event datasets: probe (2026-10-16)

Mechanical probe of public per-record datasets for the `fzp-timelapse` composition. Queried live via Socrata SODA (data.sf.gov) and CKAN (data.ca.gov) on 2026-10-16.

## 1. DBI Building Permits `i98e-djp9` (PDDL, daily, 1,297,008 rows)

- Dates: `permit_creation_date`, `filed_date`, `approved_date`, `issued_date`, `first_construction_document_date` (from 1989-03-27; site permits only), `completed_date`, `status_date`, `last_permit_activity_date`.
- `status` is current-only. Types 1/2: complete 9,841, expired 1,860, cancelled 1,315, issued 873, withdrawn 842, filed 525, approved 145, plus reinstated, filing, triage, disapproved, suspend.
- `permit_type` 1 = new construction, 2 = new construction wood frame; `site_permit` Y/null; `proposed_units`, `existing_units` are text (cast `::number`).
- Keys: `block`+`lot`, `permit_number`, `record_id` (one per address row). **Filter `primary_address_flag='Y'`** (7,775 rows → 5,662 permits for types 1/2, units ≥ 2).
- Nulls (types 1/2, units ≥ 2, primary, n=5,662): filed 0.4%, approved 17%, issued 19%, first construction document 73%, completed 35%.
- No status history. "triage" records have null `filed_date`. For a site permit, construction starts at `first_construction_document_date`. Since 12/2024 records are only added/updated.
- PermitSF `tyz3-vt28` (Feb 2026+) covers simple permit types only; multifamily new construction remains in `i98e` — watch for migration.

**Addenda with routing `87xy-gk8d`** (PDDL, daily, 4.01M rows, 1.08M permits): one row per review step — `application_number`, `addenda_number` (0 = site/full permit, 1+ = addenda), `step`, `station` (CPB, CP-ZOC = Planning, BLDG, SFFD, DPW-BSM, SFPUC, PPC…), `department`, `arrive`, `assign_date`, `start_date`, `in_hold`, `out_hold`, `finish_date`, `approved_date`, `addenda_status`, `review_results`, `hold_description`, `title`. Real dated event history of permit review. Junk dates (1721, 2205) — clip.

## 2. Development Pipeline `6jgi-cpb4` (CC0, quarterly, 1,917 rows, 2026-Q2)

- Dates: `approved_date_planning` (57% filled, 1997–2026-07), `current_status_date`.
- `current_status`: PL Filed 443, PL Approved 409, BP Filed 367, BP Approved 92, BP Issued 114, Construction 486.
- Keys: `blklot`, `case_no` (Planning), `bpa_no` (DBI), `bpa_form_no`, `is_site_permit`.
- Current snapshot only. Past snapshots retired; available on request from the dataset owner (page contact). Old ids 404: f7r8-58gw (2022Q1), n5ik-nmm3, x44m-i8fi (2014Q3), ep85-j8df, hnm3-9g9n (2013Q4), evrp-pcmc (2013Q2), 92yj-xuxv (2012Q1). Scattered Wayback copies (2022-12-08 of f7r8-58gw; 2025-08-05 of 6jgi-cpb4; 2011/2012 xls). Status definitions changed 2022Q1.

## 3. Planning records

- **`qvu5-m3a2` Projects (PRJ)** (public domain, daily, 54,640 rows): `open_date` (1974–2026), `close_date`, `project_decision_date`, `environmental_document_date` (text); `record_status`, `project_decision` (Approved 8,570, Disapproved 615, "Withdawn" 619 [sic], Cancelled 219); `number_of_units_prop`, `number_of_units_net`, `new_construction`; keys `record_id` (YYYY-NNNNNNPRJ), `block`/`lot`, `child_id` (list), `building_permits` (DBI permit numbers, list). `project_decision_date` nearly empty for projects opened 2010–2023; of 5+ unit PRJs opened 2014–2020 (n=1,729), 1,394 are "Closed" with no decision. Many PRJs exist only for BP referrals.
- **`y673-d69b` Non-Projects / child records** (public domain, daily, 234,320 rows): ENV, CUA, VAR, DNX, PPA, APL…; `record_status` (e.g. "Closed - CEQA Clearance Issued", "Disapproved", "Appeal Upheld"), `open_date`, `close_date`, `parent_id`. No decision date; `close_date` is the proxy.
- **`d4jk-jw33` Project Application Review metrics** (PDDL, daily, 67,534 rows, 45,401 projects): `b1_alt_id` (PRJ id), `project_stage`, `start_event_type/date`, `end_event_type/date`, `metric_value` (days). "Accepted to approved" with end type "approval" gives **approval dates for 14,923 projects, 2013-05 to 2026-10** — best entitlement-date source. Denied projects have no approval row.
- `kncr-c6jw` (deprecated) returns 0 rows.

## 4. Production / completion

- `xdht-4php` Housing Production 2005–present (public domain, annual, 6,157 permits): `issued_date`, `authorization_date` (= first construction document for site permits), `first_completion_date`, `latest_completion_date`; keys `bpa`, `blocklot`, `ppts_project_id` (73%). Completed only.
- `j67f-aayr` Dwelling Unit Completion Counts (PDDL, monthly, 2,559 rows): `date_issued`, `document_type` (Initial TCO 219, Amended TCO 91, CFC 2,248), `number_of_units_certified`; phased occupancy from 2018; join `building_permit_application`. Some bad dates.
- `aaxw-2cb8` MOHCD Affordable Pipeline (PDDL, quarterly, 190 projects): entitlement, BP issuance, first construction document, estimated start and completion; 100%-affordable only.

## 5. HCD APR (data.ca.gov, licence unspecified), SF 2018–2025

- Table A (3,130 SF rows): `APP_SUBMIT_DT`, `TOT_PROPOSED_UNITS`, `TOT_APPROVED_UNITS`, `TOT_DISAPPROVED_UNITS`, `APPLICATION_STATUS`; id = PRJ number.
- Table A2 (5,899 SF rows): `ENT_APPROVE_DT1`, `BP_ISSUE_DT1`, `CO_ISSUE_DT1` with units per stage. `JURS_TRACKING_ID` is PRJ on entitlement rows but DBI permit on BP/CO rows → join on `APN` or via PRJ `building_permits`. Rows are per reporting year with that year's events only. Entitlement rows sparse until 2024.

## Rough cohort check (`i98e-djp9`)

```
SELECT permit_number, status, status_date, filed_date, approved_date, issued_date,
 first_construction_document_date, completed_date, proposed_units, site_permit
WHERE permit_type in ('1','2') AND proposed_units::number >= 5 AND primary_address_flag='Y'
 AND filed_date between '2014-01-01' and '2020-12-31T23:59:59' LIMIT 5000
```

441 permits, 36,446 units (422 site permits). Reached: approved 69% (74% of units), issued 60% (66%), first construction document 44% (54%), completed 40% (50%). Current status: complete 178, issued 75, filed 86, approved 34, withdrawn 33, cancelled 29 (8 after issuance), reinstated 4, expired 1, disapproved 1. Dead 64 (15%, 3,876 units); open 199 (heavy right-censoring).

| Interval | Median days | IQR | n |
|---|---|---|---|
| filed → issued | 542 | 327–934 | 266 |
| issued → first construction document | 200 | 126–421 | 196 |
| first construction document → completed | 920 | 730–1,129 | 170 |
| issued → completed | 1,138 | 939–1,556 | 178 |
| filed → completed | 1,741 | 1,358–2,145 | 178 |

Rough: survivor-biased, no censoring correction.

## Ranking

1. `i98e-djp9` + `87xy-gk8d`: permit filed → completion, permit-level attrition.
2. `d4jk-jw33` + `qvu5-m3a2` + `y673-d69b`: entitlement stage and Planning-side exits; PRJ → permits via `building_permits`. Reliable ~2013/2018+.
3. `j67f-aayr`, `xdht-4php`: completion and phased occupancy.
4. HCD APR A/A2: cross-check (2018+).
5. `6jgi-cpb4`: current in-flight state; durations only with past snapshots on request.

Cannot tell us: deaths before any filing; reasons for dropout; actual groundbreaking beyond first construction document (inspections not probed); Planning decision dates 2010–2023 in the PRJ table; indefinite stalls except as right-censored records.
