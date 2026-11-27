import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

// Pipeline tests never touch the developer's shared cache.
const root = mkdtempSync(join(tmpdir(), 'sfh-cache-test-'));
process.env.SFH_CACHE_DIR = root;
afterAll(() => rmSync(root, { recursive: true, force: true }));
