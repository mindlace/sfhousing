import { z } from 'zod';

// zod 4 probes for eval support with `Function('')` on first object parse so it can JIT-compile
// parsers. The CSP (svelte.config.js) has no 'unsafe-eval', so the probe always fails in the
// browser and zod falls back to its interpreter anyway, but the probe still fires a
// `securitypolicyviolation` (script-src eval) on every page load. Opting out up front keeps the
// same parsing behaviour without the violation (map e2e E1 asserts none).
z.config({ jitless: true });
