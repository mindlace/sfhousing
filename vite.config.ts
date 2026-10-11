import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  test: {
    expect: { requireAssertions: true },
    projects: [
      // Browser/client tests live in a standalone config that omits sveltekit() + tailwindcss().
      './vite.config.client-test.ts',
      {
        extends: './vite.config.ts',
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/**/*.{test,spec}.ts', 'scripts/**/*.spec.ts'],
          exclude: ['src/**/*.svelte.{test,spec}.ts']
        }
      }
    ]
  }
});
