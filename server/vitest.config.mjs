import { defineConfig } from "vitest/config";

/**
 * Vitest config for the SERVER, which is CommonJS (`"type": "commonjs"`).
 *
 * This file is `.mjs` on purpose. A plain `vitest.config.js` would be parsed as
 * CommonJS under this package's type field, and `export default` would throw.
 *
 * `globals: true` matters more than it looks: it puts `describe`, `it`, `expect`,
 * `beforeAll` and friends on the global object, so a test file needs no `import`
 * statement at all and can `require()` application code exactly the way the app
 * does. That keeps ARCHITECTURE.md invariant "server stays CommonJS" intact
 * inside the tests as well as outside them.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.js"],
    setupFiles: ["./src/__tests__/setup.js"],

    // An in-memory mongod is started per test FILE, not per test. Running files
    // in parallel would start several at once and make the suite flaky on a
    // laptop, so files run one at a time. Tests inside a file still run fast.
    fileParallelism: false,

    // mongodb-memory-server downloads a mongod binary the first time it runs.
    // On a cold cache that is slow, and the default 5s hook timeout fails long
    // before the download finishes.
    hookTimeout: 120000,
    testTimeout: 30000,

    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // The domain layer is where the money arithmetic lives and where three
      // real defects were found. Everything else is HTTP shape and glue.
      include: ["src/services/**", "src/utils/**", "src/controllers/**"],
    },
  },
});
