// The server's schema 4 policy codec (timeline-ui Task 15, R-4): publish takes schema 4 only;
// stored rows of schema 2, 3 and 4 load as validated text, never upgraded or reconciled.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FUTURE_SCHEMA_MESSAGE } from '$lib/plan';
import {
  month,
  painted4,
  painted4Text,
  paintedText,
  simDoc,
  simDoc4,
  tamperedText
} from '$lib/server/test/sim-docs';
import {
  DEFAULT_POLICY,
  SCHEMA2_PUBLISH_MESSAGE,
  SIM_CODEC,
  serializeSimDoc
} from '$lib/sim-page/sim-doc';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { addPolicy } from './add';
import { DEFAULT_POLICY4 } from './policy4';
import { SIM_SERVER_CODEC4 } from './server-codec';
import { SIM_KEY4, serializeSimDoc4 } from './sim-doc4';

const C = SIM_SERVER_CODEC4;
const schema2 = () =>
  readFileSync(new URL('../sim-page/fixtures/schema2/painted.json', import.meta.url), 'utf8');

describe('SIM_SERVER_CODEC4.parse (publish)', () => {
  it('publish accepts schema 4 and rejects 2 and 3 as unknown-schema', () => {
    const text = painted4Text({ title: 'Mission' });
    const r = C.parse(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ schema: 4, kind: 'sim', datasetVersion: 'fixture-0' });
    expect(r.value.title).toBe('Mission');
    expect(r.value.policy).toEqual(painted4());
    expect(r.value.text).toBe(text);

    for (const old of [paintedText(), schema2()]) {
      const bad = C.parse(old);
      expect(bad).toMatchObject({ ok: false });
      if (bad.ok) continue;
      expect(bad.errors[0]).toMatchObject({
        code: 'unknown-schema',
        message: SCHEMA2_PUBLISH_MESSAGE
      });
    }
    const future = C.parse(JSON.stringify({ ...JSON.parse(text), schema: 5 }));
    expect(future).toMatchObject({ ok: false, errors: [{ code: 'future-schema' }] });
  });

  it('serializes publish to the canonical text, whatever the spacing sent', () => {
    const canonical = painted4Text();
    const r = C.parse(JSON.stringify(JSON.parse(canonical), null, 2));
    expect(r.ok && C.serialize(r.value)).toBe(canonical);
  });

  it('a given measure parses on the server', () => {
    const cal = fixtureCalibration();
    const ctx = { w: { asOf: cal.asOf, months: 480 }, month: 1, cal };
    const policy = addPolicy(
      DEFAULT_POLICY4,
      { kind: 'money', what: 'preset', preset: 'housing-bond' },
      ctx
    ).doc;
    const r = C.parse(serializeSimDoc4(simDoc4(policy)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.policy?.kinds.money[0].preset).toBe('housing-bond');
  });

  it('an unaligned span is accepted: the server has no dataset date', () => {
    const r = C.parse(painted4Text({}, month(2) + 3));
    expect(r.ok).toBe(true);
  });
});

describe('SIM_SERVER_CODEC4.load (stored rows)', () => {
  it('a stored schema 3 row loads as its own text, not upgraded', () => {
    const text = paintedText();
    const r = C.load(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ schema: 3, kind: 'sim', datasetVersion: 'fixture-0' });
    expect(r.value.policy).toBeNull();
    expect(C.serialize(r.value)).toBe(text);
    expect(C.schema(r.value)).toBe(4);
  });

  it('a stored schema 2 row keeps its text (so the page can say what it added)', () => {
    const text = schema2();
    const r = C.load(text);
    expect(r.ok && r.value.schema).toBe(2);
    expect(r.ok && C.serialize(r.value)).toBe(text);
  });

  it('a stored schema 4 row from an earlier dataset loads unaligned', () => {
    const text = painted4Text({ datasetVersion: 'fixture-1' }, month(2) + 3);
    const r = C.load(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.policy?.kinds.zoning[0].spans[0].from).toBe(month(2) + 3);
    expect(C.serialize(r.value)).toBe(text);
  });

  it('a tampered stored row loads (lenient); a newer schema fails future-schema', () => {
    expect(C.load(tamperedText()).ok).toBe(true);
    expect(C.load(JSON.stringify({ ...JSON.parse(painted4Text()), schema: 5 }))).toEqual({
      ok: false,
      errors: [{ path: '/schema', code: 'future-schema', message: FUTURE_SCHEMA_MESSAGE }]
    });
    expect(C.load('{"nope":1}').ok).toBe(false);
    expect(C.load('not json').ok).toBe(false);
    expect(C.load(JSON.stringify({ ...JSON.parse(painted4Text()), kind: 'plan' })).ok).toBe(false);
  });
});

describe('SIM_SERVER_CODEC4 description', () => {
  it('is empty when nothing is in force; legacy rows by the schema 3 default', () => {
    const empty4 = C.parse(serializeSimDoc4(simDoc4()));
    expect(empty4.ok && C.isEmpty(empty4.value)).toBe(true);
    const full4 = C.parse(painted4Text());
    expect(full4.ok && C.isEmpty(full4.value)).toBe(false);

    const empty3 = C.load(serializeSimDoc(simDoc()));
    expect(empty3.ok && C.isEmpty(empty3.value)).toBe(true);
    const full3 = C.load(paintedText());
    expect(full3.ok && C.isEmpty(full3.value)).toBe(false);
  });

  it('counts spans; a legacy row as the schema 3 codec counted it', () => {
    const [a] = painted4().kinds.zoning;
    const later = { ...a.spans[0], from: month(13) };
    const b = { ...a, id: 'painted-2', spans: [{ ...a.spans[0], to: month(13) - 1 }, later] };
    const doc = simDoc4({ schema: 4, kinds: { ...DEFAULT_POLICY4.kinds, zoning: [a, b] } });
    const r = C.parse(serializeSimDoc4(doc));
    expect(r.ok && C.opCount(r.value)).toBe(3);

    const legacy = C.load(paintedText());
    const old = SIM_CODEC.load(paintedText());
    expect(legacy.ok && old.ok && C.opCount(legacy.value)).toBe(
      old.ok && SIM_CODEC.opCount(old.value)
    );
  });

  it('names the policy routes, and is schema 4 with the schema 4 empty document', () => {
    expect(C.kind).toBe('sim');
    expect(C.api).toBe('/api/policies');
    expect(C.path('Abcdefg2')).toBe('/s/Abcdefg2');
    expect(C.storageKey).toBe(SIM_KEY4);
    const e = C.empty('fixture-2');
    expect(e).toMatchObject({ schema: 4, datasetVersion: 'fixture-2', policy: DEFAULT_POLICY4 });
    expect(C.serialize(e)).toBe(
      serializeSimDoc4(simDoc4(DEFAULT_POLICY4, { datasetVersion: 'fixture-2' }))
    );
    expect(C.isEmpty(e)).toBe(true);
  });

  it('rebase and title keep the text in step', () => {
    const r = C.parse(painted4Text());
    if (!r.ok) throw new Error('fixture');
    const moved = C.rebase(r.value, 'fixture-3');
    expect(C.datasetVersion(moved)).toBe('fixture-3');
    expect(JSON.parse(C.serialize(moved)).datasetVersion).toBe('fixture-3');
    const titled = C.withTitle(r.value, '  Hi  ');
    expect(C.title(titled)).toBe('Hi');
    expect(JSON.parse(C.serialize(titled)).title).toBe('Hi');
    expect('title' in JSON.parse(C.serialize(C.withTitle(titled, ' ')))).toBe(false);
    expect(C.publishable(r.value)).toBe(r.value);

    const legacy = C.load(serializeSimDoc(simDoc(DEFAULT_POLICY)));
    if (!legacy.ok) throw new Error('fixture');
    expect(JSON.parse(C.serialize(C.rebase(legacy.value, 'fixture-3'))).datasetVersion).toBe(
      'fixture-3'
    );
  });
});
