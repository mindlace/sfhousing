import fs from 'node:fs';
import path from 'node:path';
import type { Duck } from '../lib/duck';
import type { Http } from '../lib/http';
import { sha256File, type LockEntry } from '../lib/lock';
import { storeBytes } from '../lib/raw';
import { EXEMPTION_HOMEPAGE, EXEMPTION_LICENSE, EXEMPTION_TABLES } from '../sb79-config';

export const SFBOS_EXEMPTIONS_ID = 'sfbos-sb79-exemptions';
export const SFBOS_EXEMPTIONS_LABEL = 'SF Board File 260132 – SB 79 exemption tables (Ord. 082-26)';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
/**
 * Path 2 (sb79-config `EXEMPTION_FETCH_PATH`): the Board File tables are Excel-printed PDFs, so
 * normalise reads a vendored `apn,table` transcription. Live, and the mini fixture's.
 */
export const SB79_EXEMPTIONS_CSV = {
  live: path.join(REPO_ROOT, 'pipeline/enrichment/sb79-exemptions.csv'),
  fixture: path.join(REPO_ROOT, 'pipeline/test/fixtures/mini/enrichment/sb79-exemptions.csv')
};

/**
 * Downloads every Board File 260132 exemption table in `EXEMPTION_TABLES`, one lock file each
 * (`sfbos-sb79-exemptions.<table>.pdf`). The PDFs are not parsed here, so `rowCount` is the file
 * count; `upstreamVersion` names the files' sha256 prefixes.
 */
export async function fetchSfbosExemptions(
  rawDir: string,
  http: Http,
  now: Date = new Date()
): Promise<LockEntry> {
  const files = [];
  for (const t of EXEMPTION_TABLES) {
    const res = await http.get(t.url);
    if (res.status !== 200) throw new Error(`GET ${t.url}: HTTP ${res.status}`);
    files.push(
      storeBytes(rawDir, `${SFBOS_EXEMPTIONS_ID}.${t.table}.${t.format}`, t.url, res.body)
    );
  }
  return {
    id: SFBOS_EXEMPTIONS_ID,
    files,
    retrievedAt: now.toISOString(),
    upstreamVersion: files.map((f) => f.sha256.slice(0, 12)).join(','),
    rowCount: files.length,
    license: EXEMPTION_LICENSE,
    label: SFBOS_EXEMPTIONS_LABEL,
    homepage: EXEMPTION_HOMEPAGE
  };
}

export type ExemptionTable = 'permanent' | 'temporary';
export interface ExemptionOriginal {
  table: ExemptionTable;
  sha256: string;
  url: string;
}

const ORIGINAL_RE = /^# original (permanent|temporary) sha256=([0-9a-f]{64}) (\S+)$/;

/** The `# original <table> sha256=<hex> <url>` lines of a transcription's comment header. */
export function readExemptionHeader(csvPath: string): ExemptionOriginal[] {
  const out: ExemptionOriginal[] = [];
  for (const line of fs.readFileSync(csvPath, 'utf8').split('\n')) {
    if (!line.startsWith('#')) break;
    const m = ORIGINAL_RE.exec(line.trimEnd());
    if (m) out.push({ table: m[1] as ExemptionTable, sha256: m[2], url: m[3] });
  }
  return out;
}

const q = (s: string) => `'${s.replaceAll("'", "''")}'`;

/**
 * Path 2 normalise: checks that the raw originals (the lock's files) are exactly the ones the
 * transcription's header names, by sha256, then writes `src_sb79_exempt(apn, tbl)` from the CSV:
 * apn upper-cased and trimmed, rows kept as transcribed (repeats included), ordered by all
 * columns. Returns the row count.
 */
export async function normaliseSfbosExemptions(
  db: Duck,
  rawFiles: string[],
  outParquet: string,
  csvPath: string = SB79_EXEMPTIONS_CSV.live
): Promise<number> {
  const header = readExemptionHeader(csvPath);
  const named = header.map((h) => h.sha256).sort();
  const raw = (await Promise.all(rawFiles.map((f) => sha256File(f)))).sort();
  if (named.length === 0 || named.join() !== raw.join()) {
    throw new Error(
      `exemption transcription is stale: ${csvPath} names originals [${named.join(', ')}], ` +
        `the lock's raw files are [${raw.join(', ')}]`
    );
  }
  const skip = fs
    .readFileSync(csvPath, 'utf8')
    .split('\n')
    .findIndex((l) => !l.startsWith('#'));
  const rel = `SELECT upper(trim(apn)) AS apn, trim("table") AS tbl
    FROM read_csv(${q(csvPath)}, skip = ${skip}, header = true, all_varchar = true,
      delim = ',', quote = '"', escape = '"')`;
  const bad = await db.all<{ tbl: string }>(
    `SELECT DISTINCT tbl FROM (${rel}) WHERE tbl IS NULL OR tbl NOT IN ('permanent', 'temporary')`
  );
  if (bad.length > 0) {
    throw new Error(`${csvPath}: table '${bad[0].tbl}' is not permanent or temporary`);
  }
  fs.mkdirSync(path.dirname(outParquet), { recursive: true });
  await db.run(`COPY (SELECT * FROM (${rel}) ORDER BY ALL) TO ${q(outParquet)} (FORMAT parquet)`);
  const [r] = await db.all<{ n: number }>(`SELECT count(*) n FROM read_parquet(${q(outParquet)})`);
  return r.n;
}
