import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      [
        ['$app/service-worker', 'worker-scope.ts'],
        ['$app/env', 'worker-version.ts'],
        ['$app/manifest', 'worker-files.ts'],
      ].map(([name, file]) => [
        name,
        fileURLToPath(new URL(`./tests/fixtures/${file}`, import.meta.url)),
      ]),
    ),
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,js}'],
      reportsDirectory: 'coverage/unit',
      reporter: ['text', 'json', 'json-summary', 'html', 'lcov'],
    },
  },
});
