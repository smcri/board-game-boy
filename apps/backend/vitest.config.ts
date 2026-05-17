import { defineConfig } from 'vitest/config';

/**
 * Backend tests touch shared on-disk artifacts (the scaffold dist/ output,
 * the bundles/ directory, the SQLite cache file). Running test FILES in
 * parallel races on these paths and produces flaky failures. We serialize
 * files but keep within-file parallelism on (`isolate: true` keeps each
 * file's test module fresh).
 */
export default defineConfig({
  test: {
    fileParallelism: false,
    isolate: true,
  },
});
