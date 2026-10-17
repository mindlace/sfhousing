/**
 * A small hand-made `ProjectRecordsInput` for the deriveProjects and V20-V24 tests (SODA shape:
 * lower-case keys, strings, nulls omitted). Projects:
 * - A `PRJ:2019-000001PRJ`: discretionary, construction, pipeline row with da 'Fixture Village'.
 * - B `BP:202403150003`: permitOnly, permitFiled; its pipeline row sets the cutoff 2026-07-28.
 * - C `PRJ:2016-000006PRJ`: complete 2019-08-01 (TCO 60 units): the citywide phase size.
 * - D `CASE:2010.0002PRX`: PRX master, 100 units, da 'Fixture Village', fallback phasing.
 * - E `CASE:2099-000099PRJ`: non-PRX pipeline-only row, 5 units (multiPhase false).
 * - F `BP:201410070008`: open, absent from the pipeline: stale-open (3 units).
 * - G `BP:201801010007`: cancelled, with a TCO: `unitsAt.complete` must not appear.
 * - one excluded alteration row (bpa names no fetched permit), 4 units.
 */
import type { ParcelId } from '../../../src/lib/data/parcel';
import type { Day } from '../../../src/lib/timelapse/time';
import type { MultiphaseFile } from '../../enrichment/schema';
import type { ProjectRecordsInput, ProjectSourceId, RawRow } from '../../project-records/types';

export function day(iso: string): Day {
  return Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
}

const ts = (iso: string) => `${iso}T00:00:00.000`;

export const ASOF = day('2026-10-10');

export const PARCELS: ReadonlySet<ParcelId> = new Set([
  '3512001',
  '3512002',
  '3512003',
  '3512004',
  '3512005',
  '3512006',
  '3512007',
  '3512008',
  '3512009'
]);

function permitRow(o: {
  number: string;
  type?: string;
  lot: string;
  status: string;
  statusDate?: string;
  filed?: string;
  issued?: string;
  fcd?: string;
  completed?: string;
  units?: number;
  stories?: number;
  site?: boolean;
  primary?: boolean;
  street?: [string, string, string];
}): RawRow {
  const r: RawRow = {
    permit_number: o.number,
    permit_type: o.type ?? '2',
    block: '3512',
    lot: o.lot,
    status: o.status,
    site_permit: o.site ? 'Y' : 'N',
    primary_address_flag: o.primary === false ? 'N' : 'Y'
  };
  if (o.street) {
    r.street_number = o.street[0];
    r.street_name = o.street[1];
    r.street_suffix = o.street[2];
  }
  if (o.statusDate) r.status_date = ts(o.statusDate);
  if (o.filed) r.filed_date = ts(o.filed);
  if (o.issued) r.issued_date = ts(o.issued);
  if (o.fcd) r.first_construction_document_date = ts(o.fcd);
  if (o.completed) r.completed_date = ts(o.completed);
  if (o.units !== undefined) r.proposed_units = String(o.units);
  if (o.stories !== undefined) r.number_of_proposed_stories = String(o.stories);
  return r;
}

function pipelineRow(o: {
  blklot: string;
  status: string;
  statusDate: string;
  caseNo?: string;
  bpaNo?: string;
  units: number;
  da?: string;
  nameaddr?: string;
  approved?: string;
}): RawRow {
  const r: RawRow = {
    blklot: o.blklot,
    current_status: o.status,
    current_status_date: ts(o.statusDate),
    new_pipeline_units: String(o.units)
  };
  if (o.caseNo) r.case_no = o.caseNo;
  if (o.bpaNo) r.bpa_no = o.bpaNo;
  if (o.da) r.da = o.da;
  if (o.nameaddr) r.nameaddr = o.nameaddr;
  if (o.approved) r.approved_date_planning = ts(o.approved);
  return r;
}

export function baseRaw(): Record<ProjectSourceId, RawRow[]> {
  return {
    'datasf-permits-newcon': [
      permitRow({
        number: '201906010001',
        lot: '001',
        status: 'issued',
        statusDate: '2021-02-01',
        filed: '2019-06-01',
        issued: '2021-02-01',
        fcd: '2021-05-03',
        units: 24,
        stories: 6,
        site: true,
        street: ['100', 'FIXTURE', 'ST']
      }),
      permitRow({
        number: '201906010001',
        lot: '002',
        status: 'issued',
        statusDate: '2021-02-01',
        filed: '2019-06-01',
        issued: '2021-02-01',
        fcd: '2021-05-03',
        units: 24,
        stories: 6,
        site: true,
        primary: false
      }),
      permitRow({
        number: '202403150003',
        type: '1',
        lot: '003',
        status: 'filed',
        statusDate: '2024-03-15',
        filed: '2024-03-15',
        units: 2
      }),
      permitRow({
        number: '201605010006',
        lot: '004',
        status: 'complete',
        statusDate: '2019-09-15',
        filed: '2016-05-01',
        issued: '2017-01-10',
        fcd: '2017-03-01',
        completed: '2019-09-15',
        units: 60,
        site: true
      }),
      permitRow({
        number: '201410070008',
        lot: '002',
        status: 'filed',
        statusDate: '2014-10-07',
        filed: '2014-10-07',
        units: 3
      }),
      permitRow({
        number: '201801010007',
        type: '1',
        lot: '007',
        status: 'cancelled',
        statusDate: '2020-01-01',
        filed: '2018-01-01',
        units: 8
      })
    ],
    'datasf-planning-projects': [
      {
        record_id: '2019-000001PRJ',
        record_status: 'Open',
        project_address: '100 Fixture St',
        block: '3512',
        lot: '001',
        open_date: ts('2019-01-15'),
        building_permits: '201906010001',
        number_of_units_prop: '24',
        new_construction: 'CHECKED'
      },
      {
        record_id: '2016-000006PRJ',
        record_status: 'Closed',
        block: '3512',
        lot: '004',
        open_date: ts('2016-03-01'),
        building_permits: '201605010006',
        number_of_units_prop: '60',
        new_construction: 'CHECKED'
      }
    ],
    'datasf-planning-records': [],
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
      }
    ],
    'datasf-unit-completions': [
      {
        building_permit_application: '201605010006',
        date_issued: ts('2019-08-01'),
        document_type: 'Initial TCO',
        number_of_units_certified: '60'
      },
      {
        building_permit_application: '201801010007',
        date_issued: ts('2019-06-01'),
        document_type: 'Initial TCO',
        number_of_units_certified: '8'
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
      pipelineRow({
        blklot: '3512001',
        status: 'Construction',
        statusDate: '2021-05-03',
        caseNo: '2019-000001PRJ',
        bpaNo: '201906010001',
        units: 24,
        da: 'Fixture Village'
      }),
      pipelineRow({
        blklot: '3512003',
        status: 'BP Filed',
        statusDate: '2026-07-28',
        bpaNo: '202403150003',
        units: 2
      }),
      pipelineRow({
        blklot: '3512006',
        status: 'PL Approved',
        statusDate: '2012-04-02',
        caseNo: '2010.0002PRX',
        units: 100,
        da: 'Fixture Village'
      }),
      pipelineRow({
        blklot: '3512005',
        status: 'PL Filed',
        statusDate: '2026-06-01',
        caseNo: '2099-000099PRJ',
        units: 5,
        nameaddr: '5 Example Ave'
      }),
      pipelineRow({
        blklot: '3512007',
        status: 'BP Filed',
        statusDate: '2026-01-01',
        bpaNo: '209901019999',
        units: 4
      })
    ]
  };
}

export function baseMultiphase(): MultiphaseFile {
  return {
    schema: 1,
    projects: [
      {
        caseNo: '2010.0002PRX',
        label: 'Fixture Village',
        schedule: null,
        searched: [
          { url: 'https://example.invalid/fixture-village-search', retrieved: '2026-10-01' }
        ],
        phases: []
      }
    ]
  };
}

export function baseInput(
  raw: Record<ProjectSourceId, RawRow[]> = baseRaw(),
  multiphase: MultiphaseFile = baseMultiphase()
): ProjectRecordsInput {
  return {
    asOf: ASOF,
    raw,
    parcelIds: PARCELS,
    lineage: (b) => (PARCELS.has(b) ? b : null),
    assessorUnits: (id) => (id === '3512002' ? 1 : null),
    latestRollYear: 2025,
    baseStories: () => 4,
    hiNet: { 2023: 3, 2024: 2, 2025: -1 },
    areaM2: (id) => 100 + Number(id.slice(-1)),
    multiphase
  };
}
