import type { Plugin } from 'vite';
import { treeDatasetVersion } from '../../pipeline/lib/version';

/**
 * Bakes the tree's dataset version into the build as `__SFH_DATASET_VERSION__` (a Vite `define`).
 * Runs on every config load (dev, build, vitest). A dirty tree computes a different version; a
 * missing git or lock fails the load loudly.
 */
export function datasetVersionPlugin(): Plugin {
  return {
    name: 'sfh-dataset-version',
    async config(userConfig, { command }) {
      const v = await treeDatasetVersion(userConfig.root ?? process.cwd());
      if (command === 'build') console.log(`dataset version ${v}`);
      return { define: { __SFH_DATASET_VERSION__: JSON.stringify(v) } };
    }
  };
}
