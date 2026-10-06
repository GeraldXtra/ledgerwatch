import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.js"],
    setupFiles: ["./src/__tests__/setup.js"],

    fileParallelism: false,

    hookTimeout: 120000,
    testTimeout: 30000,

    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/services/**", "src/utils/**", "src/controllers/**"],
    },
  },
});
