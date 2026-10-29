import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { idsHash } from './column-file';
import { policyTiny } from './fixtures/policy-tiny';
import { scenarioTiny } from './fixtures/scenario-tiny';
import {
  HISTORIC_CODES,
  NULL_CAP,
  PolicyFormatError,
  S207_STATUSES,
  SB79_STATUSES,
  decodePolicyPayload,
  encodePolicyPayload,
  isNeighborhoodCommercial,
  readPolicyParcels,
  type PolicyParcels
} from './policy-codec';

const tiny = scenarioTiny();
const bytes = encodePolicyPayload(policyTiny(tiny));

/** Rewrite the header JSON of `bytes` (edits may not grow it; the rest is blank-padded). */
function patchHeader(edit: (h: Record<string, unknown>) => void): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const H = dv.getUint32(8, true);
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + H)));
  edit(h);
  const text = JSON.stringify(h);
  expect(text.length).toBeLessThanOrEqual(H); // JSON tolerates trailing blanks
  const out = bytes.slice();
  out.set(new TextEncoder().encode(text.padEnd(H)), 12);
  return out;
}
/** Byte offset of a named column in `bytes`. */
function columnAt(name: string): number {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + dv.getUint32(8, true))));
  return h.columns.find((c: { name: string }) => c.name === name).offset;
}

describe('sfh-policy/1 codec', () => {
  it('round-trips the tiny policy file byte-identically', () => {
    const d = decodePolicyPayload(bytes, tiny);
    expect(encodePolicyPayload(d)).toEqual(bytes);
    expect(d.idsHash).toBe(idsHash(tiny.id));
  });

  it('holds a row of every status and every flag the brief names', () => {
    const d = decodePolicyPayload(bytes, tiny);
    expect([...d.sb79Status].sort()).toEqual(SB79_STATUSES.map((_, k) => k));
    expect(new Set(d.s207Status).size).toBe(tiny.count);
    expect(S207_STATUSES.length).toBeGreaterThan(tiny.count);
    expect(d.currentFromS207).toContain(1);
    expect(d.fzpYieldCap).toContain(NULL_CAP);
    expect(d.exemptPermanent).toContain(1);
    expect(d.exemptTemporary).toContain(1);
    const hist = Array.from(d.historic, (k) => HISTORIC_CODES[k]);
    expect(hist).toContain('A*');
    expect(hist).toContain('B');
    expect(Array.from(d.historicProtected)).toEqual(
      hist.map((c) => (c === 'A' || c === 'A*' ? 1 : 0))
    );
  });

  it('refuses a parcels.bin it was not built for', () => {
    expect(() => decodePolicyPayload(bytes, { ...tiny, count: tiny.count - 1 })).toThrow(
      PolicyFormatError
    );
    expect(() => decodePolicyPayload(bytes, { ...tiny, id: [...tiny.id].reverse() })).toThrow(
      /idsHash/
    );
    expect(() =>
      decodePolicyPayload(bytes, { ...tiny, id: tiny.id.map((x, i) => (i ? x : x + 'X')) })
    ).toThrow(/idsHash/);
    expect(() => decodePolicyPayload(bytes, { ...tiny, datasetVersion: 'fixture-9' })).toThrow(
      /datasetVersion/
    );
    expect(() => decodePolicyPayload(bytes, { ...tiny, fillLevels: [0.5, 1] })).toThrow(
      /fillLevels/
    );
  });

  it('rejects reserved flag bits, out-of-range codes and historicProtected that disagrees with historic', () => {
    const reserved = bytes.slice();
    reserved[columnAt('flags')] |= 0x40;
    expect(() => decodePolicyPayload(reserved, tiny)).toThrow(/reserved bit/);

    const badCode = bytes.slice();
    badCode[columnAt('s207Status')] = S207_STATUSES.length;
    expect(() => decodePolicyPayload(badCode, tiny)).toThrow(/s207Status\[0\]/);

    const disagree = bytes.slice();
    disagree[columnAt('flags') + 1] ^= 0x20; // row 1 is A*: clear its historicProtected bit
    expect(() => decodePolicyPayload(disagree, tiny)).toThrow(/historicProtected/);
  });

  it('rejects a code list that differs from the constants', () => {
    const p = patchHeader((h) => {
      (h.todBands as string[])[0] = 'nope';
    });
    expect(() => decodePolicyPayload(p, tiny)).toThrow(/todBands/);
    const q = patchHeader((h) => {
      (h.sb79Statuses as string[]).reverse();
    });
    expect(() => decodePolicyPayload(q, tiny)).toThrow(/sb79Statuses/);
  });

  it('rejects a bad magic, major version, format, rule and tier source', () => {
    const magic = bytes.slice();
    magic[0] = 0x58;
    expect(() => decodePolicyPayload(magic, tiny)).toThrow(/bad magic/);
    const major = bytes.slice();
    major[4] = 2;
    expect(() => decodePolicyPayload(major, tiny)).toThrow(/major version/);
    expect(() =>
      decodePolicyPayload(
        patchHeader((h) => (h.format = 'sfh-policy/9')),
        tiny
      )
    ).toThrow(/unknown format/);
    expect(() =>
      decodePolicyPayload(
        patchHeader((h) => (h.currentLawRule = 'fzp+s207.99')),
        tiny
      )
    ).toThrow(/currentLawRule/);
    expect(() =>
      decodePolicyPayload(
        patchHeader((h) => (h.tierSource = 'bart')),
        tiny
      )
    ).toThrow(/tierSource/);
  });

  it('rejects a missing header key and invalid provenance', () => {
    expect(() =>
      decodePolicyPayload(
        patchHeader((h) => {
          h.idsHasX = h.idsHash;
          delete h.idsHash;
        }),
        tiny
      )
    ).toThrow(/missing key idsHash/);
    expect(() =>
      decodePolicyPayload(
        patchHeader((h) => {
          (h.provenance as Record<string, unknown>).sb79 = { tier: 9, label: 'x' };
        }),
        tiny
      )
    ).toThrow(/provenance\.sb79/);
  });

  it('surfaces a truncated buffer as PolicyFormatError', async () => {
    for (const cut of [5, 40, bytes.length - 1]) {
      expect(() => decodePolicyPayload(bytes.subarray(0, cut), tiny)).toThrow(PolicyFormatError);
    }
    await expect(readPolicyParcels(deflateRawSync(bytes.subarray(0, 40)), tiny)).rejects.toThrow(
      PolicyFormatError
    );
  });

  it('encoder rejects bad lengths, non-0/1 flags and out-of-range indices', () => {
    const good = policyTiny(tiny);
    const with_ = (patch: Partial<PolicyParcels>) => ({ ...good, ...patch });
    expect(() => encodePolicyPayload(with_({ sb79Cap: new Uint16Array(2) }))).toThrow(
      PolicyFormatError
    );
    expect(() => encodePolicyPayload(with_({ sb79Yield: new Uint16Array(3) }))).toThrow(
      /sb79Yield/
    );
    expect(() =>
      encodePolicyPayload(with_({ hostableSb79: Uint8Array.of(2, 0, 0, 0, 0, 0) }))
    ).toThrow(/not 0 or 1/);
    expect(() => encodePolicyPayload(with_({ todBand: Uint8Array.of(4, 0, 0, 0, 0, 0) }))).toThrow(
      /todBand\[0\]/
    );
    expect(() =>
      encodePolicyPayload(with_({ useDistricts: ['', 'RM-1', 'RH-2', 'NC-2'] }))
    ).toThrow(/sorted/);
  });

  it('isNeighborhoodCommercial reads split codes', () => {
    expect(['NC-1', 'NCT', 'NCT-3', 'RH-2|NC-2'].map(isNeighborhoodCommercial)).toEqual([
      true,
      true,
      true,
      true
    ]);
    expect(['RH-1', 'C-3-O', 'RC-4', ''].map(isNeighborhoodCommercial)).toEqual([
      false,
      false,
      false,
      false
    ]);
  });

  it('isNeighborhoodCommercial matches every NC code in the zone-class rules and no neighbour', () => {
    // pipeline/sb79-config.ts ZONE_CLASS_RULES: NC-1/2/3/S, NCT, NCT-1..3, NCD.
    const nc = ['NC-1', 'NC-2', 'NC-3', 'NC-S', 'NCT', 'NCT-1', 'NCT-2', 'NCT-3', 'NCD'];
    expect(nc.map(isNeighborhoodCommercial)).toEqual(nc.map(() => true));
    const other = ['NC-4', 'NCT-4', 'RCD', 'CRNC', 'RTO-C', 'C-2', 'MUG', 'CMUO'];
    expect(other.map(isNeighborhoodCommercial)).toEqual(other.map(() => false));
  });

  it('readPolicyParcels inflates a deflate-raw body', async () => {
    expect((await readPolicyParcels(deflateRawSync(bytes), tiny)).count).toBe(tiny.count);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(deflateRawSync(bytes)));
        c.close();
      }
    });
    expect((await readPolicyParcels(stream, tiny)).count).toBe(tiny.count);
  });

  it('readPolicyParcels turns a corrupt deflate body into PolicyFormatError', async () => {
    const packed = new Uint8Array(deflateRawSync(bytes));
    const corrupt = packed.map((b, i) => (i < 8 ? 0xff : b));
    await expect(readPolicyParcels(corrupt, tiny)).rejects.toThrow(PolicyFormatError);
    await expect(readPolicyParcels(packed.subarray(0, 10), tiny)).rejects.toThrow(
      PolicyFormatError
    );
  });
});
