import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{apps,packages,workers}/**/*.test.ts'],
    environment: 'node',
    // Workspace packages export raw TypeScript; make sure Vite transforms them.
    server: { deps: { inline: [/@memetize\//] } },
    // Integration suites share one test database; run files serially so their
    // per-test truncations and migrations never overlap.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
