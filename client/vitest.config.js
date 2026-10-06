import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Vitest config for the CLIENT, which is ESM (`"type": "module"`), so a plain
 * `.js` config is fine here — unlike the server, which needs `.mjs`.
 *
 * THIS COMMENT USED TO SAY THERE WERE NO CLIENT TESTS AND THAT THIS WAS
 * DELIBERATE, pointing at BUILD_PLAN.md P4-3 and P3-2 for when they would
 * arrive. They arrived. There are dozens, including a 584-line suite checking
 * Bitcoin derivation against the published BIP-84 vectors and the coin-selection
 * arithmetic, plus the market money-path guards — all found by the `include`
 * pattern below. A contributor opening this file to decide whether to write a
 * test was being told not to bother, which is LW-047 sitting on the one file
 * that decides how tests run.
 *
 * The npm script still passes `--passWithNoTests`. Keep that in mind rather than
 * trusting it: if the include pattern ever stops matching, an empty run reports
 * success, which is precisely the green-looking failure the note two paragraphs
 * down had to be written about.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    /**
     * `node`, not `jsdom`, as the default.
     *
     * The forks pool on Windows timed out waiting for a worker to respond while
     * jsdom loaded, so a passing test file reported as "no tests" with exit 1 —
     * a green looking failure. Nothing here touches the DOM: the tests are on
     * pure money arithmetic. A component test can opt back in per file with
     * `// @vitest-environment jsdom`.
     */
    environment: "node",
    pool: "threads",
    include: ["src/**/*.test.{js,jsx}"],
  },
});
