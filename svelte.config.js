import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        'img-src': ['self', 'data:', 'blob:'],
        'style-src': ['self', 'unsafe-inline'],
        'worker-src': ['self', 'blob:'],
        'connect-src': ['self'],
        'font-src': ['self'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'frame-ancestors': ['none']
      }
    }
  }
};

export default config;
