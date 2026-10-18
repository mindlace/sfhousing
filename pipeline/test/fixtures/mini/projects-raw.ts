/**
 * The mini fixture's project records (spec 4.9 Fixture table): the seven project sources in SODA
 * shape (lower-case keys, every value a string, absent values omitted, floating timestamps
 * `YYYY-MM-DDT00:00:00.000`). make-fixture.ts writes these as `raw/<lockId>.page-000.json`.
 *
 * | project                | records                                                                   |
 * | ---------------------- | ------------------------------------------------------------------------- |
 * | M1 2019-000001PRJ      | lot 010; PPA, ENV, d4jk approval 2020-03-02; permit 201906010001; pipeline |
 * | M2 2026-000002PRJ      | lot 013; sb35; 8-story description; pipeline PL Filed                     |
 * | M3 BP 202403150003     | lot 005; type 1 permit, no PRJ; pipeline BP Filed 2026-07-28 (cutoff)     |
 * | M4 2021-000004PPA      | lot 013; unparented PPA, closed 2021-06-30                                |
 * | M5 2017-000005PRJ      | lot 013; Closed - Withdrawn 2018-04-02; CUA child                         |
 * | M6 2016-000006PRJ      | lot 006; permit 201605010006 complete; TCO 2019-08-01                     |
 * | M7 BP 201410070008     | lot 005; permit filed 2014-10-07, no PRJ, no pipeline row (stale-open)    |
 * | M8 2020-000008PRJ      | referral PRJ; permit 202006010008 on retired lot 099; pipeline BP Issued  |
 * | M9 2007.0001PRX        | pipeline-only, lot 014, 300 units, da 'Fixture Shipyard' (enriched)       |
 * | M10 2020-000010PRJ     | lot 001; permit A withdrawn, permit B filed; d4jk approval; pipeline      |
 * | M11 2026-000011PRJ     | lot 006; opened 2026-09-20, 3 units, no evidence, no pipeline row         |
 * | M12 2026-000012PRJ     | lot 008; umbrella PRJ and PPA opened 2026-08-03, 24 units (12 existing)   |
 * | M13 2015-000013PRJ     | lot 012; Closed, no decision, closed 2016-05-02                           |
 * | M14 2010.0002PRX       | pipeline-only, lot 009, 100 units, da 'Fixture Village' (fallback);       |
 * |                        | base case PRJ 2010.0002 (lot 007) with completed permit 201501150014      |
 * | M15 2025-000015PRJ     | lot 3; referral PRJ (10 units); permit 202504010015, 5,540 units, 3 stories |
 * | M16 2024-000016PRX     | lot 4; no-date PRX row linked to PRJ 2024-000016PRJ (200 units, ENV, d4jk) |
 * | M17 2025-000017PRX     | lot 007; no-date PRX row linked to PRJ 2025-000017PRJ (0 units): excluded  |
 * | M18 2026-000018PRJ     | lot 009; no-date row, no such record, no open PRJ on the lot: dropped     |
 * | M19 BP 202501150019    | lot 001; type 1 permit, shares lot 1 with M10; pipeline BP Filed          |
 * | M20 2012-000020PRX     | lot 006; pipeline-only, 10 units, da 'Fixture Yards'; netted by M11       |
 * | xdht extras            | forms 2 (+3), 3 (+2) and 6 (-1): rhnaCompletedNet 4                       |
 *
 * Every pipeline row's `new_pipeline_units` equals its project's units, except M16's (220 against
 * the record's 200), so V21 coverage is below 1.0 (spec 4.9 V21).
 * `miniProjectInput()` serves the callbacks as stubs mirroring scenario-data's fixture (lineage,
 * and assessor units aggregated from the landed roll CSV), so Task 12 can compare it with the real
 * panel.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ParcelId } from '../../../../src/lib/data/parcel';
import type { Day } from '../../../../src/lib/timelapse/time';
import { parseMultiphase } from '../../../enrichment/schema';
import { descendantsIndex, type ParcelAttrsRow } from '../../../project-records/descendants';
import type { ProjectRecordsInput, ProjectSourceId, RawRow } from '../../../project-records/types';

export const MINI_ASOF: Day = Date.parse('2026-10-10T00:00:00Z') / 86_400_000;

/** The 14 mini parcel ids (README lot table). */
export const MINI_PARCELS: ReadonlySet<ParcelId> = new Set<ParcelId>([
  '3512001',
  '3512002',
  '8711023C',
  '0026T001A',
  '3512005',
  '3512006',
  '3512007',
  '3512008',
  '3512009',
  '3512010',
  '3512011',
  '3512012',
  '3512013',
  '3512014'
]);

/** SODA floating timestamp. */
const ts = (iso: string) => `${iso}T00:00:00.000`;

interface PermitSpec {
  number: string;
  /** Default '3512'; lots 3 (`8711023C`) and 4 (`0026T001A`) have their own blocks. */
  block?: string;
  type: '1' | '2';
  lot: string;
  status: string;
  statusDate: string;
  filed: string;
  issued?: string;
  fcd?: string;
  completed?: string;
  units: number;
  stories?: number;
  primary?: boolean;
  street?: [number: string, name: string, suffix: string];
}

/** One i98e-djp9 address row (block 3512). */
function permit(o: PermitSpec): RawRow {
  const r: RawRow = {
    permit_number: o.number,
    permit_type: o.type,
    block: o.block ?? '3512',
    lot: o.lot
  };
  if (o.street) {
    r.street_number = o.street[0];
    r.street_name = o.street[1];
    r.street_suffix = o.street[2];
  }
  r.status = o.status;
  r.status_date = ts(o.statusDate);
  r.filed_date = ts(o.filed);
  if (o.issued) r.issued_date = ts(o.issued);
  if (o.fcd) r.first_construction_document_date = ts(o.fcd);
  if (o.completed) r.completed_date = ts(o.completed);
  if (o.stories !== undefined) r.number_of_proposed_stories = String(o.stories);
  r.proposed_units = String(o.units);
  r.site_permit = 'Y';
  r.primary_address_flag = o.primary === false ? 'N' : 'Y';
  return r;
}

interface PipelineSpec {
  blklot: string;
  status: string;
  /** Absent for a DQ-2 row (no `current_status_date`). */
  statusDate?: string;
  caseNo?: string;
  bpaNo?: string;
  units: number;
  da?: string;
}

/** One 6jgi-cpb4 row. */
function pipeline(o: PipelineSpec): RawRow {
  const r: RawRow = { blklot: o.blklot, current_status: o.status };
  if (o.statusDate) r.current_status_date = ts(o.statusDate);
  if (o.caseNo) r.case_no = o.caseNo;
  if (o.bpaNo) r.bpa_no = o.bpaNo;
  r.new_pipeline_units = String(o.units);
  if (o.da) r.da = o.da;
  return r;
}

export const PROJECT_RAW: Record<ProjectSourceId, RawRow[]> = {
  'datasf-permits-newcon': [
    // M1: one site permit with address rows on lots 010 (primary) and 011.
    permit({
      number: '201906010001',
      type: '2',
      lot: '010',
      status: 'issued',
      statusDate: '2021-02-01',
      filed: '2019-06-01',
      issued: '2021-02-01',
      fcd: '2021-05-03',
      completed: '1909-06-02',
      units: 24,
      stories: 6,
      street: ['100', 'FIXTURE', 'ST']
    }),
    permit({
      number: '201906010001',
      type: '2',
      lot: '011',
      status: 'issued',
      statusDate: '2021-02-01',
      filed: '2019-06-01',
      issued: '2021-02-01',
      fcd: '2021-05-03',
      completed: '1909-06-02',
      units: 24,
      stories: 6,
      primary: false
    }),
    // M3.
    permit({
      number: '202403150003',
      type: '1',
      lot: '005',
      status: 'filed',
      statusDate: '2024-03-15',
      filed: '2024-03-15',
      units: 2
    }),
    // M6.
    permit({
      number: '201605010006',
      type: '2',
      lot: '006',
      status: 'complete',
      statusDate: '2019-09-15',
      filed: '2016-05-01',
      issued: '2017-01-10',
      fcd: '2017-03-01',
      completed: '2019-09-15',
      units: 12
    }),
    // M7.
    permit({
      number: '201410070008',
      type: '2',
      lot: '005',
      status: 'filed',
      statusDate: '2014-10-07',
      filed: '2014-10-07',
      units: 3
    }),
    // M8: on retired lot 099 (lineage maps it to lot 012).
    permit({
      number: '202006010008',
      type: '2',
      lot: '099',
      status: 'issued',
      statusDate: '2021-03-01',
      filed: '2020-06-01',
      issued: '2021-03-01',
      units: 4
    }),
    // M10: permit A withdrawn, then the refiled permit B.
    permit({
      number: '202001100010',
      type: '2',
      lot: '001',
      status: 'withdrawn',
      statusDate: '2021-01-01',
      filed: '2020-01-10',
      units: 6
    }),
    permit({
      number: '202203010010',
      type: '2',
      lot: '001',
      status: 'filed',
      statusDate: '2022-03-01',
      filed: '2022-03-01',
      units: 6
    }),
    // M14's base case: the completed 40-unit building on lot 007.
    permit({
      number: '201501150014',
      type: '2',
      lot: '007',
      status: 'complete',
      statusDate: '2017-04-01',
      filed: '2015-01-15',
      issued: '2015-06-01',
      fcd: '2015-08-01',
      completed: '2017-04-01',
      units: 40
    }),
    // M15 (pr.units.capacity, modelled on live 8500988): 5,540 units on 3 stories of a 300 m2 lot
    // exceed 300 x 3 / 10 = 90, so the permit's units are missing.
    permit({
      number: '202504010015',
      type: '2',
      block: '8711',
      lot: '023C',
      status: 'filed',
      statusDate: '2025-04-01',
      filed: '2025-04-01',
      units: 5540,
      stories: 3
    }),
    // M19 (pr.parcels.shared-existing): on lot 001 with M10, which entered earlier.
    permit({
      number: '202501150019',
      type: '1',
      lot: '001',
      status: 'filed',
      statusDate: '2025-01-15',
      filed: '2025-01-15',
      units: 3
    })
  ],
  'datasf-planning-projects': [
    {
      record_id: '2019-000001PRJ',
      record_status: 'Open',
      project_address: '100 Fixture St',
      block: '3512',
      lot: '010',
      open_date: ts('2019-01-15'),
      building_permits: '201906010001',
      number_of_units_prop: '24',
      new_construction: 'CHECKED'
    },
    {
      record_id: '2026-000002PRJ',
      record_status: 'Open',
      block: '3512',
      lot: '013',
      open_date: ts('2026-05-01'),
      number_of_units_prop: '40',
      new_construction: 'CHECKED',
      sb35: 'CHECKED',
      description:
        'Demolish the existing two-story building and construct a new 8-story building with 40 homes'
    },
    {
      record_id: '2017-000005PRJ',
      record_status: 'Closed - Withdrawn',
      block: '3512',
      lot: '013',
      open_date: ts('2017-02-01'),
      close_date: ts('2018-04-02'),
      number_of_units_prop: '9',
      new_construction: 'CHECKED'
    },
    {
      record_id: '2016-000006PRJ',
      record_status: 'Closed',
      block: '3512',
      lot: '006',
      open_date: ts('2016-03-01'),
      building_permits: '201605010006',
      number_of_units_prop: '12',
      new_construction: 'CHECKED'
    },
    // M8: a referral, opened a month after its permit was filed, with no evidence.
    {
      record_id: '2020-000008PRJ',
      record_status: 'Open',
      block: '3512',
      lot: '099',
      open_date: ts('2020-07-01'),
      building_permits: '202006010008'
    },
    {
      record_id: '2020-000010PRJ',
      record_status: 'Open',
      block: '3512',
      lot: '001',
      open_date: ts('2019-12-01'),
      building_permits: '202001100010,202203010010',
      number_of_units_prop: '6',
      new_construction: 'CHECKED'
    },
    {
      record_id: '2026-000011PRJ',
      record_status: 'Open',
      block: '3512',
      lot: '006',
      open_date: ts('2026-09-20'),
      number_of_units_prop: '3',
      new_construction: 'CHECKED'
    },
    {
      record_id: '2026-000012PRJ',
      record_status: 'Open',
      block: '3512',
      lot: '008',
      open_date: ts('2026-08-03'),
      // 24 units on lot 008's 12 existing (fixture roll): nets 12.
      number_of_units_prop: '24',
      new_construction: 'CHECKED'
    },
    {
      record_id: '2015-000013PRJ',
      record_status: 'Closed',
      block: '3512',
      lot: '012',
      open_date: ts('2015-04-01'),
      close_date: ts('2016-05-02'),
      number_of_units_prop: '5',
      new_construction: 'CHECKED'
    },
    // M14's base case (an old-style case number).
    {
      record_id: '2010.0002',
      record_status: 'Closed',
      block: '3512',
      lot: '007',
      open_date: ts('2010-01-05'),
      building_permits: '201501150014',
      number_of_units_prop: '40',
      new_construction: 'CHECKED'
    },
    // M15: a referral (opened 12 days before its permit was filed, no evidence) with 10 units.
    {
      record_id: '2025-000015PRJ',
      record_status: 'Under Review',
      block: '8711',
      lot: '023C',
      open_date: ts('2025-03-20'),
      building_permits: '202504010015',
      number_of_units_prop: '10',
      new_construction: 'CHECKED'
    },
    // M16: the Planning record M16's no-date PRX row links to (DQ-2); no pipeline row of its own.
    {
      record_id: '2024-000016PRJ',
      record_status: 'Under Review',
      block: '0026T',
      lot: '001A',
      open_date: ts('2024-02-01'),
      number_of_units_prop: '200',
      new_construction: 'CHECKED'
    },
    // M17: the open record on lot 007 that M17's no-date PRX row links to; no units, so the row is
    // excluded (projects.excludedNoUnits). Lot 7's other PRJ, 2010.0002, ended complete.
    {
      record_id: '2025-000017PRJ',
      record_status: 'Under Review',
      block: '3512',
      lot: '007',
      open_date: ts('2025-09-12'),
      number_of_units_prop: '0'
    }
  ],
  'datasf-planning-records': [
    {
      record_id: '2018-000001PPA',
      record_type: 'PPA',
      record_status: 'Closed',
      block: '3512',
      lot: '010',
      parent_id: '2019-000001PRJ',
      open_date: ts('2018-11-01')
    },
    {
      record_id: '2019-000001ENV',
      record_type: 'ENV',
      record_status: 'Closed',
      block: '3512',
      lot: '010',
      parent_id: '2019-000001PRJ',
      open_date: ts('2019-02-01')
    },
    // M4: no parent; ppaLag (75 days, from M1) attaches it to nothing.
    {
      record_id: '2021-000004PPA',
      record_type: 'PPA',
      record_status: 'Closed',
      block: '3512',
      lot: '013',
      open_date: ts('2021-03-01'),
      close_date: ts('2021-06-30')
    },
    {
      record_id: '2017-000005CUA',
      record_type: 'CUA',
      record_status: 'Closed - Withdrawn',
      block: '3512',
      lot: '013',
      parent_id: '2017-000005PRJ',
      open_date: ts('2017-02-01'),
      close_date: ts('2018-04-02')
    },
    {
      record_id: '2026-000012PPA',
      record_type: 'PPA',
      record_status: 'Open',
      block: '3512',
      lot: '008',
      parent_id: '2026-000012PRJ',
      open_date: ts('2026-08-03')
    },
    {
      record_id: '2024-000016ENV',
      record_type: 'ENV',
      record_status: 'Open',
      block: '0026T',
      lot: '001A',
      parent_id: '2024-000016PRJ',
      open_date: ts('2024-03-01')
    }
  ],
  'datasf-planning-review': [
    {
      b1_alt_id: '2019-000001PRJ',
      start_event_type: 'accepted',
      start_event_date: ts('2019-01-20'),
      end_event_type: 'approval',
      end_event_date: ts('2020-03-02')
    },
    {
      b1_alt_id: '2016-000006PRJ',
      start_event_type: 'accepted',
      start_event_date: ts('2016-03-10'),
      end_event_type: 'approval',
      end_event_date: ts('2016-04-15')
    },
    {
      b1_alt_id: '2020-000010PRJ',
      start_event_type: 'accepted',
      start_event_date: ts('2020-02-01'),
      end_event_type: 'approval',
      end_event_date: ts('2021-11-01')
    },
    {
      b1_alt_id: '2010.0002',
      start_event_type: 'accepted',
      start_event_date: ts('2010-02-01'),
      end_event_type: 'approval',
      end_event_date: ts('2012-03-01')
    },
    // M16's review, accepted and not yet decided: the discretionary evidence (spec 4.4 rule 2; an
    // ENV child alone is filing evidence, not pathway evidence).
    {
      b1_alt_id: '2024-000016PRJ',
      start_event_type: 'accepted',
      start_event_date: ts('2024-04-15')
    }
  ],
  'datasf-unit-completions': [
    {
      building_permit_application: '201605010006',
      date_issued: ts('2019-08-01'),
      document_type: 'Initial TCO',
      number_of_units_certified: '12'
    },
    {
      building_permit_application: '201501150014',
      date_issued: ts('2017-03-01'),
      document_type: 'CFC',
      number_of_units_certified: '40'
    }
  ],
  'datasf-housing-production': [
    {
      bpa: '202101050007',
      form_no: '2',
      net_units_completed: '3',
      first_completion_date: ts('2023-05-10')
    },
    {
      bpa: '202201010001',
      form_no: '3',
      net_units_completed: '2',
      first_completion_date: ts('2024-02-01')
    },
    {
      bpa: '202301010001',
      form_no: '6',
      net_units_completed: '-1',
      first_completion_date: ts('2025-01-15')
    }
  ],
  'datasf-dev-pipeline': [
    pipeline({
      blklot: '3512010',
      status: 'Construction',
      statusDate: '2021-05-03',
      caseNo: '2019-000001PRJ',
      bpaNo: '201906010001',
      units: 24
    }),
    pipeline({
      blklot: '3512013',
      status: 'PL Filed',
      statusDate: '2026-05-15',
      caseNo: '2026-000002PRJ',
      units: 40
    }),
    // M3: the newest status date, so it sets pipelineCutoff.
    pipeline({
      blklot: '3512005',
      status: 'BP Filed',
      statusDate: '2026-07-28',
      bpaNo: '202403150003',
      units: 2
    }),
    pipeline({
      blklot: '3512099',
      status: 'BP Issued',
      statusDate: '2021-03-01',
      bpaNo: '202006010008',
      units: 4
    }),
    pipeline({
      blklot: '3512014',
      status: 'PL Approved',
      statusDate: '2008-06-12',
      caseNo: '2007.0001PRX',
      units: 300,
      da: 'Fixture Shipyard'
    }),
    pipeline({
      blklot: '3512001',
      status: 'BP Filed',
      statusDate: '2022-03-01',
      caseNo: '2020-000010PRJ',
      bpaNo: '202203010010',
      units: 6
    }),
    pipeline({
      blklot: '3512009',
      status: 'PL Approved',
      statusDate: '2012-04-02',
      caseNo: '2010.0002PRX',
      units: 100,
      da: 'Fixture Village'
    }),
    // M15: the capacity case's pipeline row.
    pipeline({
      blklot: '8711023C',
      status: 'BP Filed',
      statusDate: '2026-06-01',
      bpaNo: '202504010015',
      units: 10
    }),
    // M16 (DQ-2, linked): no status date; joins 2024-000016PRJ on lot 4. Its 220 units are not used.
    pipeline({ blklot: '0026T001A', status: 'PL Filed', caseNo: '2024-000016PRX', units: 220 }),
    // M17 (DQ-2, no units): no status date; joins 2025-000017PRJ on lot 7, which has no units.
    pipeline({ blklot: '3512007', status: 'PL Filed', caseNo: '2025-000017PRX', units: 900 }),
    // M18 (no status date, no PRJ): no record 2026-000018PRJ exists and lot 009 has no open PRJ.
    pipeline({ blklot: '3512009', status: 'PL Filed', caseNo: '2026-000018PRJ', units: 20 }),
    pipeline({
      blklot: '3512001',
      status: 'BP Filed',
      statusDate: '2026-05-01',
      bpaNo: '202501150019',
      units: 3
    }),
    // M20 (DA netting, score-only): M11 (3 units, lot 006, no pipeline row) nets it to 7.
    pipeline({
      blklot: '3512006',
      status: 'PL Approved',
      statusDate: '2013-05-01',
      caseNo: '2012-000020PRX',
      units: 10,
      da: 'Fixture Yards'
    })
  ]
};

const MULTIPHASE = fileURLToPath(new URL('./enrichment/multiphase.json', import.meta.url));

/** Retired and condo block-lots (scenario-data's mini lineage). */
const LINEAGE: Record<string, ParcelId> = {
  '3512099': '3512012',
  '3512101': '3512002',
  '3512102': '3512002',
  '3512103': '3512002'
};

const lineage = (b: string): ParcelId | null => LINEAGE[b] ?? (MINI_PARCELS.has(b) ? b : null);

const ROLL = fileURLToPath(new URL('./raw/datasf-assessor-roll.page-000.csv', import.meta.url));
const ATTRS = fileURLToPath(new URL('./raw/datasf-parcel-attrs.page-000.csv', import.meta.url));

/**
 * The landed mini parcel attrs as src_parcel_attrs holds them (pipeline/sources/normalise.ts:
 * trimmed upper-case block-lots, '' as null, `active` true/1/false/0 else null, dates as days),
 * for the `descendants` callback (main's ruling 3, Ruling D1 revised). Every mini tracking lot is
 * active, so each descends only to itself.
 */
function attrsRows(): ParcelAttrsRow[] {
  const lines = readFileSync(ATTRS, 'utf8').trim().split('\n');
  const unquote = (s: string) => s.replace(/^"|"$/g, '').trim();
  const header = lines[0].split(',').map(unquote);
  const col = (name: string) => header.indexOf(name);
  const text = (s: string) => (s === '' ? null : s.toUpperCase());
  const flag = (s: string) =>
    s === 'true' || s === '1' ? true : s === 'false' || s === '0' ? false : null;
  const out: ParcelAttrsRow[] = [];
  for (const line of lines.slice(1)) {
    const f = line.split(',').map(unquote);
    const blklot = text(f[col('blklot')]);
    if (blklot === null) continue;
    out.push({
      blklot,
      mapblklot: text(f[col('mapblklot')]),
      active: flag(f[col('active')].toLowerCase()),
      added: f[col('date_rec_add')].slice(0, 10) || null,
      dropped: f[col('date_rec_drop')].slice(0, 10) || null
    });
  }
  return out;
}

/**
 * Assessor units per `<current parcel>|<roll year>`, aggregated from the landed fixture roll as
 * scenario-data's `sc_roll_agg` does (pipeline/sql/80_scenario.sql): each row's `parcel_number`
 * maps through lineage (condo sub-lots and retired lots to their current parcel), then
 * `number_of_units` is summed per (parcel, year). A (parcel, year) with no roll row is absent.
 * The panel's `existing_units` then applies scenario-data's units rules (scenario-data spec §4.11
 * and §4.12, RA1), which on mini touch lots 3 and 4 only; `RA1_PANEL_UNITS` gives those values.
 * pipeline/test/golden.test.ts checks this stub against the built panel for every parcel-year.
 */
function rollUnits(): Map<string, number> {
  const lines = readFileSync(ROLL, 'utf8').trim().split('\n');
  const unquote = (s: string) => s.replace(/^"|"$/g, '');
  const header = lines[0].split(',').map(unquote);
  const col = (name: string) => header.indexOf(name);
  const [yearCol, parcelCol, unitsCol] = [
    col('closed_roll_year'),
    col('parcel_number'),
    col('number_of_units')
  ];
  const sums = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const f = line.split(',').map(unquote);
    const id = lineage(f[parcelCol]);
    if (id === null) continue;
    const key = `${id}|${Number(f[yearCol])}`;
    sums.set(key, (sums.get(key) ?? 0) + (f[unitsCol] === '' ? 0 : Number(f[unitsCol])));
  }
  for (const [key, units] of Object.entries(RA1_PANEL_UNITS)) sums.set(key, units);
  return sums;
}

/**
 * The panel's post-rule units where they differ from the roll sum (scenario-data spec §4.11):
 * lot 3's 5,000 in 2023 and 2025 become its LUDB 4 (sd.roll.units-capacity), and its missing 2024
 * is carried from 2023 (sd.roll.year-gap); lot 4's 900 in 2024 becomes 2023's 3.
 */
const RA1_PANEL_UNITS: Record<string, number> = {
  '8711023C|2023': 4,
  '8711023C|2024': 4,
  '8711023C|2025': 4,
  '0026T001A|2024': 3
};

/**
 * The deriveProjects input for the mini records, with stub callbacks mirroring scenario-data's
 * fixture: lineage above; descendants from the landed parcel attrs (attrsRows); assessor units
 * as the panel has them (2023 to 2025, see rollUnits);
 * no base stories; every parcel 300 m2; fixture `hiNet`; the mini `multiphase.json`.
 */
export function miniProjectInput(): ProjectRecordsInput {
  const units = rollUnits();
  return {
    asOf: MINI_ASOF,
    raw: PROJECT_RAW,
    parcelIds: MINI_PARCELS,
    lineage,
    descendants: descendantsIndex(attrsRows(), { parcelIds: MINI_PARCELS, lineage }),
    assessorUnits: (id, year) => units.get(`${id}|${year}`) ?? null,
    latestRollYear: 2025,
    baseStories: () => null,
    hiNet: { 2023: 3, 2024: 2, 2025: -1 },
    areaM2: () => 300,
    multiphase: parseMultiphase(JSON.parse(readFileSync(MULTIPHASE, 'utf8')))
  };
}
