import { afterEach, describe, expect, it, vi } from "vitest";

async function loadBase(env) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import("../base.js");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("LW-021 — the API address never falls back to localhost in a production build", () => {
  it("uses the configured address, without a trailing slash", async () => {
    const base = await loadBase({ VITE_API_URL: "https://api.example.com/", DEV: false });
    expect(base.API_BASE).toBe("https://api.example.com");
    expect(base.API_MISSING).toBe(false);
  });

  it("reports the address as missing in a production build without one", async () => {
    const base = await loadBase({ VITE_API_URL: "", DEV: false });
    expect(base.API_BASE).toBe("");
    expect(base.API_MISSING).toBe(true);
  });

  it("uses the local server only while developing", async () => {
    const base = await loadBase({ VITE_API_URL: "", DEV: true });
    expect(base.API_BASE).toBe("http://localhost:8000");
    expect(base.API_MISSING).toBe(false);
  });
});
