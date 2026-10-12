import { describe, expect, it } from 'vitest';
// Exercise our config through chreode's actual planner/selector, not source-text assertions.
import { loadConfig } from '../node_modules/@mindlace/chreode/dist/config/load.js';
import { planSignoff } from '../node_modules/@mindlace/chreode/dist/signoff/plan.js';
import {
  burnInCommands,
  selectBurnIn
} from '../node_modules/@mindlace/chreode/dist/burn-in/select.js';
import gpu from '../playwright.roof-gpu.config';
import gpuUnit from '../vite.config.roof-gpu';

const config = await loadConfig(new URL('../chreode.config.ts', import.meta.url).pathname);

describe('roof signoff integration', () => {
  it('does not absorb cold native activation failures through retries', () => {
    expect(gpu.retries).toBe(0);
    expect(gpuUnit.test!.retry ?? 0).toBe(0);
  });
  it.each([
    'src/lib/map/roof-layer.ts',
    'src/lib/data/roof-mesh.ts',
    'e2e/roofs.spec.ts',
    'pipeline/roofs/process.py',
    'playwright.roof-gpu.config.ts',
    'scripts/roof-gpu-launch.ts'
  ])('runs the native roof gate when %s changes', (path) => {
    const plan = planSignoff(config, {
      paths: [path],
      full: false,
      skip: [],
      base: 'base',
      head: 'head',
      isWorktree: true
    });
    expect(plan.steps.map((s) => s.command)).toContain('npm run test:roofs:gpu');
  });

  it('keeps roof burn-in on the native runners', () => {
    const plan = selectBurnIn(
      [
        'e2e/roofs.spec.ts',
        'src/lib/map/roof-layer.svelte.spec.ts',
        'src/lib/map/SimMap.roofs.svelte.spec.ts',
        'src/lib/map/SimMap.roof-import-held.svelte.spec.ts'
      ],
      config.burnIn!
    );
    const commands = burnInCommands(plan, 5);
    expect(commands).toHaveLength(6);
    expect(commands[0].command).toContain('--config playwright.roof-gpu.config.ts');
    expect(commands[0].command).toContain('--repeat-each=5');
    expect(
      commands.slice(1).every((c) => c.command.includes('--config vite.config.roof-gpu.ts'))
    ).toBe(true);
  });

  it('selects roof tests in exactly the desktop and mobile GPU projects', () => {
    expect(gpu.projects!.map((p) => p.name)).toEqual(['chromium', 'mobile']);
    for (const project of gpu.projects!) {
      expect(project.testIgnore).toEqual([]);
      expect(project.testMatch).toBe('roofs.spec.ts');
      expect(project.dependencies ?? []).toEqual([]);
    }
  });
});
