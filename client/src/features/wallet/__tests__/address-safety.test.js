import { describe, it, expect } from "vitest";
import { counterpartiesFrom, lookalikeOf } from "../addressSafety";

const MINE = "0x1111111111111111111111111111111111111111";
const FRIEND = "0xAbCd5678901234567890123456789012345678Ef";
const POISON = "0xabcd" + "0".repeat(32) + "78ef";

describe("address poisoning — a lookalike of an address you have used is flagged", () => {
  it("flags an address that starts and ends like one in your history but is different", () => {
    expect(POISON.slice(2, 6).toLowerCase()).toBe(FRIEND.slice(2, 6).toLowerCase());
    expect(POISON.slice(-4).toLowerCase()).toBe(FRIEND.slice(-4).toLowerCase());
    expect(lookalikeOf(POISON, [FRIEND])).toBe(FRIEND);
  });

  it("does not flag the very address you used before, in any letter case", () => {
    expect(lookalikeOf(FRIEND.toLowerCase(), [FRIEND])).toBeNull();
  });

  it("still flags the poisoner's address even though it is in your history as a sender", () => {
    const history = [
      { from: MINE, to: FRIEND },
      { from: POISON, to: MINE },
    ];
    expect(lookalikeOf(POISON, counterpartiesFrom(history, MINE))).toBe(FRIEND);
  });

  it("leaves your own address and malformed entries out of the comparison", () => {
    const list = counterpartiesFrom([{ from: MINE, to: "not an address" }, { from: MINE, to: FRIEND }], MINE);
    expect(list).toEqual([FRIEND]);
  });

  it("does not flag an unrelated address", () => {
    expect(lookalikeOf("0x9999999999999999999999999999999999999999", [FRIEND])).toBeNull();
  });
});
