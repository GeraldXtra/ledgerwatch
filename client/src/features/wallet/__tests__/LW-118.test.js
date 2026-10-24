import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

const root = new URL("../../../../../", import.meta.url);
const toml = readFileSync(new URL(".gitleaks.toml", root), "utf8").replace(/\r\n/g, "\n");
const listFile = readFileSync(new URL(".githooks/bip39-english.txt", root), "utf8").replace(/\r\n/g, "\n");

function goToJs(pattern) {
  return new RegExp(pattern.replace(/^\(\?i\)/, ""), pattern.startsWith("(?i)") ? "gi" : "g");
}

const ruleStart = toml.indexOf('id = "bip39-mnemonic"');
const ruleEnd = toml.indexOf("[[rules]]", ruleStart);
const block = toml.slice(ruleStart, ruleEnd);
const ruleSource = block.match(/^regex = '''(.*)'''$/m)[1];
const allowStart = block.indexOf("[rules.allowlist]");
const allowSources = [...block.slice(allowStart, block.indexOf("paths = [", allowStart)).matchAll(/'''(.*?)'''/g)].map(
  (m) => m[1]
);

function findings(text) {
  const rule = goToJs(ruleSource);
  const allow = allowSources.map((s) => new RegExp(s.replace(/^\(\?i\)/, ""), "i"));
  return [...text.matchAll(rule)].map((m) => m[0]).filter((secret) => !allow.some((a) => a.test(secret)));
}

const random = (bits) => generateMnemonic(wordlist, bits);

describe("LW-118 — the secret scan's recovery-phrase rule", () => {
  it("is built from the official BIP-39 English wordlist, unaltered", () => {
    expect(listFile.split("\n").filter(Boolean)).toEqual(wordlist);
  });

  it("finds a real phrase of every length, in any case, inside code", () => {
    for (const bits of [128, 160, 192, 224, 256]) {
      const phrase = random(bits);
      expect(findings(phrase)).toHaveLength(1);
      expect(findings(`const seed = "${phrase.toUpperCase()}";`)).toHaveLength(1);
    }
    const vector = ["legal", "winner", "thank", "year", "wave", "sausage", "worth", "useful"];
    expect(findings([...vector, "legal", "winner", "thank", "yellow"].join(" "))).toHaveLength(1);
  });

  it("finds a phrase that happens to contain example, test or abandon abandon", () => {
    const words = random(128).split(" ");
    for (const swap of [["example"], ["test"], ["abandon", "abandon"]]) {
      const phrase = [...words.slice(0, 4), ...swap, ...words.slice(4 + swap.length)].join(" ");
      expect(findings(phrase)).toHaveLength(1);
    }
  });

  it("ignores the ordinary sentences that used to fail the scan", () => {
    const prose = [
      "backdrop now closes only when the press AND the release were both",
      "The address that was saved does not match the one this wallet derived",
      "you did not create this account you can ignore this message and nothing will happen",
      "Chase the money you are owed and watch the markets you cannot",
      "Make sure nobody can see your screen and that you are not sharing",
      "minute was the only one printed and every other kind was dropped without",
    ];
    for (const line of prose) expect(findings(line)).toEqual([]);
  });

  it("ignores only the exact published test vectors and the wordlist's opening", () => {
    expect(findings(Array(11).fill("abandon").concat("about").join(" "))).toEqual([]);
    expect(findings(Array(23).fill("zoo").concat("vote").join(" "))).toEqual([]);
    expect(findings(wordlist.slice(0, 12).join(" "))).toEqual([]);
    expect(findings(random(128).split(" ").slice(0, 11).join(" "))).toEqual([]);
  });
});
