import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Vitest config for the CLIENT, which is ESM (`"type": "module"`), so a plain
 * `.js` config is fine here — unlike the server, which needs `.mjs`.
 *
 * There are no client tests yet, and that is deliberate. BUILD_PLAN.md P4-3 puts
 * the money-path integration tests first, because that is where every verified
 * S0 defect lives. Client tests arrive with P3-2, when the four-state fetching
 * contract gives them something worth asserting. `--passWithNoTests` in the npm
 * script keeps CI green until then rather than failing on an empty suite.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.{js,jsx}"],
  },
});
