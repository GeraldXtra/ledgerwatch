import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GUIDE } from "../guide";
import { ARTICLES } from "../articles";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const BASE = "https://www.useledgerwatch.co";

function sourceToRegExp(source) {
  const pattern = source
    .replace(/\/:[A-Za-z]+\*/g, "(?:/.*)?")
    .replace(/:[A-Za-z]+/g, "[^/]+");
  return new RegExp(`^${pattern}$`);
}

describe("what search engines and the host are told", () => {
  const sitemap = read("public/sitemap.xml");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  it("lists every guide page once, with the first page at /docs", () => {
    expect(locs).toContain(`${BASE}/docs`);
    expect(locs).not.toContain(`${BASE}/docs/${GUIDE[0].slug}`);
    for (const page of GUIDE.slice(1)) expect(locs).toContain(`${BASE}/docs/${page.slug}`);
    expect(new Set(locs).size).toBe(locs.length);
  });

  it("lists every article and the other public pages", () => {
    for (const a of ARTICLES) expect(locs).toContain(`${BASE}/articles/${a.slug}`);
    for (const p of ["/", "/about", "/pricing", "/articles", "/contact", "/privacy", "/terms"]) {
      expect(locs).toContain(`${BASE}${p}`);
    }
  });

  it("keeps private pages out of search", () => {
    const robots = read("public/robots.txt");
    for (const p of ["/app/", "/pay/", "/unsubscribe/"]) expect(robots).toContain(`Disallow: ${p}`);
    expect(robots).toContain(`Sitemap: ${BASE}/sitemap.xml`);
    expect(locs.some((l) => /\/(app|pay|unsubscribe)\//.test(l))).toBe(false);
  });

  it("serves every route the app has, and nothing else, from the app", () => {
    const vercel = JSON.parse(read("vercel.json"));
    const rewrites = vercel.rewrites.map((r) => sourceToRegExp(r.source));
    const routes = [...read("src/App.jsx").matchAll(/path="(\/[^"]*)"/g)].map((m) => m[1]).filter((p) => p !== "/");
    for (const route of routes) {
      const sample = route.replace(/:[A-Za-z]+/g, "sample-value");
      expect(rewrites.some((re) => re.test(sample)), `${route} has no rewrite`).toBe(true);
    }
    expect(rewrites.some((re) => re.test("/app/market"))).toBe(true);
    expect(rewrites.some((re) => re.test("/no-such-page"))).toBe(false);
    expect(fs.existsSync(path.join(root, "public", "404.html"))).toBe(true);
  });
});

describe("the guide's pictures", () => {
  it("has a file for every picture the guide shows, and no file the guide does not use", () => {
    const shown = new Set(GUIDE.flatMap((page) => page.blocks.filter((b) => b.type === "img").map((b) => b.src)));
    const files = new Set(fs.readdirSync(path.join(root, "public", "docs")));
    expect([...shown].filter((f) => !files.has(f))).toEqual([]);
    expect([...files].filter((f) => !shown.has(f))).toEqual([]);
  });
});
