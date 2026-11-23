import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import ts from 'typescript';

const isFile = (p: string): boolean => existsSync(p) && statSync(p).isFile();

/** The file a relative or `$lib` specifier names: the path, then `.ts`, then `/index.ts`. */
function resolveSpecifier(root: string, fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('$lib/')) base = join(root, 'src/lib', specifier.slice(5));
  else if (specifier.startsWith('.')) base = resolve(root, dirname(fromFile), specifier);
  else return null;
  const candidates = [base, `${base}.ts`, join(base, 'index.ts')];
  if (base.endsWith('.js')) candidates.push(`${base.slice(0, -3)}.ts`);
  const hit = candidates.find(isFile);
  return hit === undefined ? '' : relative(root, hit).split('\\').join(posix.sep);
}

/**
 * Every module reachable from `entries` through static imports, type-only imports,
 * `export … from` and literal `import('…')`. Only `.ts` files are parsed; a resolved `.json` or
 * `.svelte` is a leaf. Package specifiers are not followed. Paths are repo-relative and posix.
 */
export function reachedModules(
  root: string,
  entries: readonly string[]
): { modules: Set<string>; unresolved: string[] } {
  const modules = new Set<string>();
  const unresolved: string[] = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (modules.has(file)) continue;
    modules.add(file);
    if (!file.endsWith('.ts')) continue;
    const text = readFileSync(join(root, file), 'utf8');
    for (const ref of ts.preProcessFile(text, true, true).importedFiles) {
      const hit = resolveSpecifier(root, file, ref.fileName);
      if (hit === null) continue;
      if (hit === '') unresolved.push(`${ref.fileName} in ${file}`);
      else queue.push(hit);
    }
  }
  return { modules, unresolved };
}

const covers = (entry: string, mod: string): boolean =>
  entry.endsWith('.ts') ? mod === entry : mod === entry || mod.startsWith(`${entry}/`);

/**
 * What is wrong between `paths` and the modules `entry` reaches: a reached module outside
 * `pipeline/` under no entry, an entry that covers no reached module, an unresolved specifier.
 */
export function pathsProblems(root: string, entry: string, paths: readonly string[]): string[] {
  const { modules, unresolved } = reachedModules(root, [entry]);
  const outside = [...modules]
    .filter((m) => !m.startsWith('pipeline/') && !paths.some((p) => covers(p, m)))
    .sort()
    .map((m) => `module outside PATHS: ${m}`);
  const idle = paths
    .filter((p) => ![...modules].some((m) => covers(p, m)))
    .map((p) => `PATHS entry reaches no module: ${p}`);
  return [...outside, ...idle, ...unresolved.map((u) => `unresolved import: ${u}`)];
}
