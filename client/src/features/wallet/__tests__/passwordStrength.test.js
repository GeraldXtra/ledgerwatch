import { describe, it, expect } from "vitest";
import { assessWalletPassword, MIN_WALLET_PASSWORD } from "../passwordStrength";

/**
 * The gate on the one password in this product that cannot be reset.
 *
 * `docs/SECURITY.md` B1 requires a minimum above 8 and a strength check, because
 * the keystore ciphertext lives in localStorage and is attacked offline, where
 * there is no rate limit and no lockout. These assert the rules hold rather than
 * the wording of any particular message.
 */
describe("assessWalletPassword", () => {
  it("sets the floor above the old eight-character rule", () => {
    expect(MIN_WALLET_PASSWORD).toBeGreaterThan(8);
  });

  it("refuses anything under the floor, however varied", () => {
    // The old gate accepted every one of these.
    for (const p of ["Passw0rd", "aB3!xY9z", "Tr0ub4dr", "9$Kq2Lm!"]) {
      const v = assessWalletPassword(p);
      expect(v.ok, `${p} should be refused`).toBe(false);
      expect(v.reason).toMatch(/at least/i);
    }
  });

  it("refuses an empty password without throwing", () => {
    for (const p of ["", null, undefined]) {
      expect(assessWalletPassword(p).ok).toBe(false);
    }
  });

  it("accepts a long passphrase of ordinary words", () => {
    const v = assessWalletPassword("copper harbour violin ledger");
    expect(v.ok).toBe(true);
    expect(v.score).toBeGreaterThanOrEqual(2);
  });

  it("scores length above symbol soup", () => {
    const longer = assessWalletPassword("correct horse battery staple");
    const shorter = assessWalletPassword("aB3!xY9zQ#w2");
    expect(longer.ok).toBe(true);
    expect(shorter.ok).toBe(true);
    expect(longer.score).toBeGreaterThanOrEqual(shorter.score);
  });

  it("refuses common passwords even when they are long enough", () => {
    for (const p of ["passwordpassword1", "ledgerwatchwallet", "1234567890123"]) {
      expect(assessWalletPassword(p).ok, `${p} should be refused`).toBe(false);
    }
  });

  it("refuses one unit repeated to reach the length", () => {
    for (const p of ["abcabcabcabcabc", "aaaaaaaaaaaaaaaa", "xyxyxyxyxyxyxyxy"]) {
      expect(assessWalletPassword(p).ok, `${p} should be refused`).toBe(false);
    }
  });

  it("refuses straight runs of keys or letters", () => {
    for (const p of ["qwertyuiopasdf", "abcdefghijklmn", "zyxwvutsrqponm"]) {
      expect(assessWalletPassword(p).ok, `${p} should be refused`).toBe(false);
    }
  });

  it("refuses a password built from the account's own email or name", () => {
    const ctx = { email: "adaeze@example.com", name: "Adaeze Okonkwo" };
    expect(assessWalletPassword("adaeze-my-wallet-key", ctx).ok).toBe(false);
    expect(assessWalletPassword("okonkwo trading ledger", ctx).ok).toBe(false);
    // The same password without that context is fine, so the rule is about the
    // account and not about the words.
    expect(assessWalletPassword("okonkwo trading ledger").ok).toBe(true);
  });

  it("ignores a context whose values are too short to be meaningful", () => {
    // A three-letter name must not blocklist every password containing it.
    const v = assessWalletPassword("copper harbour violin", { name: "Ada" });
    expect(v.ok).toBe(true);
  });

  it("returns no reason when it passes, and a usable sentence when it fails", () => {
    expect(assessWalletPassword("copper harbour violin ledger").reason).toBe("");
    const bad = assessWalletPassword("short");
    expect(bad.reason.length).toBeGreaterThan(20);
    expect(bad.reason.trim().endsWith(".")).toBe(true);
  });

  it("grades a very long, varied password highest", () => {
    const v = assessWalletPassword("Copper-Harbour-Violin-Ledger-92");
    expect(v.ok).toBe(true);
    expect(v.score).toBe(4);
    expect(v.label).toBe("Strong");
  });
});
