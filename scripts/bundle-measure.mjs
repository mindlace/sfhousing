// `node scripts/bundle-measure.mjs [entry] [outfile]`: bundles a measurement script (default
// scripts/ensemble-measure.ts) to plain ESM for `node --expose-gc <outfile>`, close to how the
// production build bundles the sim worker: minified, `keepNames` off, modern target. Vite 8
// builds the worker with Rolldown, minify 'oxc' and target 'baseline-widely-available'
// (chrome111 and peers), and this repo's vite.config.ts sets no worker or keepNames option; tsx
// instead runs esbuild with `keepNames` on, which wraps every named closure in a `__name` call.
// The output goes to the git-ignored /scratch/ by default. Measurement only.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const entry = process.argv[2] ?? 'scripts/ensemble-measure.ts';
const outfile = process.argv[3] ?? 'scratch/ensemble-measure.bundle.mjs';

await build({
  absWorkingDir: root,
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  // es2022 is what chrome111 / safari16.4 accept, as baseline-widely-available
  target: 'es2022',
  minify: true,
  keepNames: false,
  tsconfig: 'tsconfig.json',
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"
  },
  logLevel: 'warning'
});
console.log(`bundled ${entry} -> ${outfile}`);
