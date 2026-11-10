// Copy the design's interface rows and global-constraint bullets into each spec, verbatim.
// Usage: node sync-rows.mjs <design> <spec>... [--check]
// --check: change nothing; exit 1 if any embedded row or constraint differs from the design.
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const check = args.includes('--check');
const [designPath, ...specs] = args.filter((a) => a !== '--check');
const design = readFileSync(designPath, 'utf8').split('\n');

const rows = new Map();
for (const l of design) {
  const m = /^\| (F\d+) \| [MD] \| /.exec(l);
  if (m) rows.set(m[1], l);
}
const gcStart = design.findIndex((l) => l === '## Global constraints');
const gcEnd = design.findIndex((l, i) => i > gcStart && l.startsWith('## '));
const constraints = new Map();
for (const l of design.slice(gcStart + 1, gcEnd)) {
  const m = /^- \*\*([^*]+)\*\*/.exec(l);
  if (m) constraints.set(m[1], l);
}

let differs = 0;
for (const path of specs) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const seenRows = [];
  const seenConstraints = new Set();
  let changed = 0;
  const out = lines.map((l) => {
    const r = /^\| (F\d+) \| [MD] \| /.exec(l);
    if (r && rows.has(r[1])) {
      seenRows.push(r[1]);
      if (l !== rows.get(r[1])) {
        changed++;
        console.log(`${path}: row ${r[1]} differs`);
        return rows.get(r[1]);
      }
      return l;
    }
    const c = /^- \*\*([^*]+)\*\*/.exec(l);
    if (c && constraints.has(c[1])) {
      seenConstraints.add(c[1]);
      if (l !== constraints.get(c[1])) {
        changed++;
        console.log(`${path}: constraint "${c[1]}" differs`);
        return constraints.get(c[1]);
      }
    }
    return l;
  });
  const missing = [...constraints.keys()].filter((k) => !seenConstraints.has(k));
  if (missing.length) {
    differs++;
    console.log(`${path}: MISSING constraints: ${missing.join(' | ')}`);
  }
  console.log(
    `${path}: rows ${seenRows.join(' ')}; ${changed} line(s) ${check ? 'differ' : 'synced'}`
  );
  differs += changed;
  if (!check && changed) writeFileSync(path, out.join('\n'));
}
if (check && differs) process.exit(1);
