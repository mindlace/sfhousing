import { PolicyFormatError } from '$lib/sim-page/policy';
import { parsePolicy4 } from '$lib/timeline/parse4';
import { simDoc4Problems } from '$lib/timeline/sim-doc4';
import { checkName } from './shapes';
import { LogFormatError, type Ruleset } from './types';

export interface RulesetProblem {
  path: string;
  message: string;
}

/** `path: message` without its prefix. */
const bare = (path: string, message: string) =>
  message.startsWith(`${path}: `) ? message.slice(path.length + 2) : message;

/**
 * The first problem with a ruleset, or null. Structure only (`asOf: null`, presets reconciled), so
 * a preset retired later never makes an accepted sim refuse edits.
 */
export function checkRuleset(r: Ruleset): RulesetProblem | null {
  try {
    checkName(r.name, 'name');
  } catch (e) {
    if (e instanceof LogFormatError) return { path: e.path, message: bare(e.path, e.message) };
    throw e;
  }
  try {
    parsePolicy4(r.policy, { asOf: null, presetLayer: 'reconcile' });
  } catch (e) {
    if (e instanceof PolicyFormatError)
      return { path: `policy.${e.path}`, message: bare(e.path, e.message) };
    throw e;
  }
  const problem = simDoc4Problems({
    schema: 4,
    kind: 'sim',
    datasetVersion: r.datasetVersion ?? 'fixture-0',
    title: r.name,
    policy: r.policy
  })[0];
  return problem ? { path: problem.path, message: problem.message } : null;
}
