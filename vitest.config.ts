import { defineConfig } from 'vitest/config';

// Vitest config that picks up tests anywhere under src/ so we don't need
// to teach the existing vite.config.ts (which is client-focused) about
// our server-side specs.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
    globals: false,
  },
});
