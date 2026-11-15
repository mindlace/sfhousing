import { describe, expect, it } from 'vitest';
import * as log from './index';

describe('public surface', () => {
  it('exports the runtime names units 2 and 4 use, and no others', () => {
    expect(Object.keys(log).sort()).toEqual([
      'BUILD_MAX',
      'DEFAULT_SIM_NAME',
      'GENESIS_HASH',
      'KEY_MAX',
      'LABEL_MAX',
      'LogError',
      'LogFormatError',
      'LogState',
      'NAME_KEY',
      'REGISTRY',
      'SHAPES_REVISION',
      'SOURCE_MAX',
      'SOURCE_RE',
      'chainHash',
      'checkRuleset',
      'commitText',
      'diff',
      'fold',
      'parseChange',
      'parseCommit',
      'parseCommitDraft',
      'policyKey',
      'reapply',
      'rulesetText',
      'spanKey',
      'toLogForm',
      'undoRedo',
      'verifyChain'
    ]);
    expect('DEFER_STROKES' in log).toBe(false);
  });
});
