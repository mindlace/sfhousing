import { describe, expect, it } from 'vitest';
import type { ProjectsFile } from '../../../src/lib/timelapse/projects';
import type { ProjectHistory } from '../../../src/lib/timelapse/types';
import { deriveProjects, serializeProjects } from '../../project-records/derive';
import {
  checkV20,
  checkV21,
  checkV22,
  checkV23,
  checkV24,
  type V2xInputs
} from '../../project-records/invariants';
import { ASOF, PARCELS, baseInput, day } from './derive-input';

const good = deriveProjects(baseInput());

function clone<T>(x: T): T {
  return structuredClone(x);
}

/** A deep copy of the good V2x inputs, edited by `edit`. */
function inputs(edit: (i: V2xInputs) => void = () => {}): V2xInputs {
  const i = clone(good.checks);
  edit(i);
  return i;
}

function v20(file: ProjectsFile, maxBytes = 2e6, warnBytes = 1e6) {
  const bytes = Buffer.from(serializeProjects(file));
  return checkV20(bytes, { asOf: ASOF, parcelIds: PARCELS, maxBytes, warnBytes });
}

function proj(f: ProjectsFile, id: string) {
  return f.projects.find((p) => p.id === id)!;
}

function hist(i: V2xInputs, id: string): ProjectHistory {
  return i.histories.find((h) => h.id === id)!;
}

describe('checkV20', () => {
  it('passes the derived file', () => {
    const r = v20(good.file);
    expect(r).toMatchObject({ id: 'V20', ok: true });
    expect(r.detail).not.toMatch(/warning/);
  });

  it('fails a duplicate id', () => {
    const f = clone(good.file);
    f.projects.splice(1, 0, clone(f.projects[0]));
    const r = v20(f);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/duplicate id/);
  });

  it('fails unsorted parcelIds', () => {
    const f = clone(good.file);
    proj(f, 'PRJ:2019-000001PRJ').parcelIds.reverse();
    const r = v20(f);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/ascending/);
  });

  it('fails a stage that is not the last history key', () => {
    const f = clone(good.file);
    proj(f, 'PRJ:2019-000001PRJ').stage = 'permitIssued';
    const r = v20(f);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/last history stage/);
  });

  it('fails a permitOnly project with filed', () => {
    const f = clone(good.file);
    const b = proj(f, 'BP:202403150003');
    b.history = { filed: day('2024-01-01'), permitFiled: b.history.permitFiled };
    const r = v20(f);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/permitOnly/);
  });

  it('fails a net-zero project that is not multi-phase', () => {
    const f = clone(good.file);
    proj(f, 'PRJ:2019-000001PRJ').existingUnits = 24;
    expect(v20(f).ok).toBe(false);
  });

  it('fails above maxBytes and notes a warning above warnBytes', () => {
    const size = Buffer.byteLength(serializeProjects(good.file));
    const over = v20(good.file, size - 1, 1);
    expect(over.ok).toBe(false);
    expect(over.detail).toMatch(/maxBytes|exceeds/);
    const warn = v20(good.file, size, size - 1);
    expect(warn.ok).toBe(true);
    expect(warn.detail).toMatch(/warning/);
  });

  it('fails unparseable bytes', () => {
    const r = checkV20(Buffer.from('{'), {
      asOf: ASOF,
      parcelIds: PARCELS,
      maxBytes: 2e6,
      warnBytes: 1e6
    });
    expect(r.ok).toBe(false);
  });
});

describe('checkV21', () => {
  it('passes the derived coverage', () => {
    expect(checkV21(good.checks, 1)).toMatchObject({ id: 'V21', ok: true });
  });

  it('fails at 0.89 and passes at 0.90 against 0.90', () => {
    const at = (m: number) =>
      checkV21(
        inputs((i) => (i.coverage = { matchedUnits: m, rowUnits: 100, rows: 3 })),
        0.9
      );
    expect(at(89).ok).toBe(false);
    expect(at(90).ok).toBe(true);
  });

  it('fails when no pipeline row is covered', () => {
    const r = checkV21(
      inputs((i) => (i.coverage = { matchedUnits: 0, rowUnits: 0, rows: 0 })),
      0.9
    );
    expect(r.ok).toBe(false);
  });
});

describe('checkV22', () => {
  const tol = { year: 0.1, total: 0.05 };

  it('passes the derived rhna against the fixture hiNet', () => {
    expect(checkV22(good.checks, { 2023: 3, 2024: 2, 2025: -1 }, tol)).toMatchObject({
      id: 'V22',
      ok: true
    });
  });

  it('fails a year outside ±10% and passes on the edge', () => {
    const with2 = (a: number, b: number) =>
      inputs((i) => (i.rhna = { byYear: { 2023: a, 2024: b }, total: a + b }));
    const hi = { 2023: 100, 2024: 100 };
    // Year edge: 110 vs 100 is exactly 10%; the total 205 vs 200 is within 5%.
    expect(checkV22(with2(110, 95), hi, tol).ok).toBe(true);
    expect(checkV22(with2(111, 94), hi, tol).ok).toBe(false);
    // Total edge: 105 + 105 = 210 vs 200 is exactly 5%; 211 is over.
    expect(checkV22(with2(105, 105), hi, tol).ok).toBe(true);
    expect(checkV22(with2(105, 106), hi, tol).ok).toBe(false);
  });

  it('fails when no cross-check year is compared', () => {
    expect(checkV22(good.checks, {}, tol).ok).toBe(false);
    expect(checkV22(good.checks, { 2019: 5 }, tol).ok).toBe(false);
  });

  it('compares only years wholly inside the window', () => {
    // 2022 is not a byYear key (the window starts 2022-06-30), so it is not compared.
    const r = checkV22(good.checks, { 2022: 1000, 2023: 3, 2024: 2, 2025: -1 }, tol);
    expect(r.ok).toBe(true);
  });
});

describe('checkV23', () => {
  it('passes the derived histories', () => {
    expect(checkV23(good.checks, true)).toMatchObject({ id: 'V23', ok: true });
  });

  it('fails decreasing entered days', () => {
    const i = inputs((x) => {
      const h = hist(x, 'PRJ:2019-000001PRJ');
      h.entered.entitled = (h.entered.filed as number) - 1;
    });
    expect(checkV23(i, true).ok).toBe(false);
  });

  it('fails a complete end whose day differs from entered.complete', () => {
    const i = inputs((x) => {
      const h = hist(x, 'PRJ:2016-000006PRJ');
      h.end = { kind: 'complete', day: (h.entered.complete as number) + 1 };
    });
    expect(checkV23(i, true).ok).toBe(false);
  });

  it('fails an end day before the last entered day', () => {
    const i = inputs((x) => {
      const h = hist(x, 'BP:201801010007');
      if (h.end.kind === 'exit') h.end.day = (h.entered.permitFiled as number) - 1;
    });
    expect(checkV23(i, true).ok).toBe(false);
  });

  it('fails an exit at a stage that was not entered', () => {
    const i = inputs((x) => {
      const h = hist(x, 'BP:201801010007');
      if (h.end.kind === 'exit') h.end.stage = 'construction';
    });
    expect(checkV23(i, true).ok).toBe(false);
  });

  it('fails lastObserved after asOf or before the first entered day', () => {
    const late = inputs((x) => {
      hist(x, 'BP:201410070008').end = { kind: 'open', lastObserved: ASOF + 1 };
    });
    expect(checkV23(late, true).ok).toBe(false);
    const early = inputs((x) => {
      hist(x, 'BP:201410070008').end = { kind: 'open', lastObserved: day('2014-10-06') };
    });
    expect(checkV23(early, true).ok).toBe(false);
  });

  it('fails a T3 pathway with no history', () => {
    const i = inputs((x) => {
      x.histories = x.histories.filter((h) => h.pathway !== 'permitOnly');
    });
    expect(checkV23(i, true).ok).toBe(false);
  });

  it('fails a rerun that is not identical', () => {
    expect(checkV23(good.checks, false).ok).toBe(false);
  });
});

describe('checkV24', () => {
  const D = 'CASE:2010.0002PRX';

  it('passes the derived phasing', () => {
    expect(checkV24(good.checks)).toMatchObject({ id: 'V24', ok: true });
  });

  it('fails when phase units do not sum to units', () => {
    const i = inputs((x) => (proj(x.file, D).phases![0].units = 99));
    expect(checkV24(i).ok).toBe(false);
  });

  it('fails phase parcels overlapping another in-flight project', () => {
    const i = inputs((x) => {
      proj(x.file, D).phases![0].parcelIds = ['3512001'];
      proj(x.file, D).parcelIds = ['3512001', '3512006'];
    });
    const r = checkV24(i);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/3512001/);
  });

  it('fails a phase with no parcels, or parcels outside the master', () => {
    expect(checkV24(inputs((x) => (proj(x.file, D).phases![0].parcelIds = []))).ok).toBe(false);
    expect(checkV24(inputs((x) => (proj(x.file, D).phases![0].parcelIds = ['3512008']))).ok).toBe(
      false
    );
  });

  it('fails plannedPermitFiled on or before history.entitled', () => {
    const i = inputs((x) => {
      const d = proj(x.file, D);
      x.multiphase.scales['2010.0002PRX'] = 1;
      d.phases![0].source = {
        label: 's',
        url: 'https://example.invalid/',
        retrieved: '2026-10-01'
      };
      d.phases![0].plannedPermitFiled = d.history.entitled!;
    });
    const r = checkV24(i);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/entitled/);
  });

  it('fails an enriched phase without source and a fallback phase with one', () => {
    const enrichedNoSource = inputs((x) => (x.multiphase.scales['2010.0002PRX'] = 1));
    expect(checkV24(enrichedNoSource).ok).toBe(false);
    const fallbackWithDate = inputs((x) => {
      proj(x.file, D).phases![0].plannedPermitFiled = day('2030-01-01');
    });
    expect(checkV24(fallbackWithDate).ok).toBe(false);
  });

  it('fails a multi-phase project with null phases unless it is a last resort', () => {
    const i = inputs((x) => (proj(x.file, D).phases = null));
    expect(checkV24(i).ok).toBe(false);
    i.multiphase.lastResort = [D];
    expect(checkV24(i).ok).toBe(true);
  });

  it('fails on buildPhases problems and multiphase file problems', () => {
    expect(checkV24(inputs((x) => x.multiphase.problems.push('p'))).ok).toBe(false);
    expect(checkV24(inputs((x) => x.multiphase.fileProblems.push('f'))).ok).toBe(false);
  });

  it('fails a scale factor of 0.79 and passes 0.8', () => {
    const at = (s: number) =>
      inputs((x) => {
        x.multiphase.scales['2010.0002PRX'] = s;
        proj(x.file, D).phases![0].source = {
          label: 's',
          url: 'https://example.invalid/',
          retrieved: '2026-10-01'
        };
      });
    expect(checkV24(at(0.79)).ok).toBe(false);
    expect(checkV24(at(0.8)).ok).toBe(true);
    expect(checkV24(at(1.26)).ok).toBe(false);
  });
});
