import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import NewTokensCard from "../NewTokensCard";

const BASE = { chainId: 8453, name: "Base" };
const html = (props) => renderToStaticMarkup(<NewTokensCard chain={BASE} tokens={[]} {...props} />);

describe("LW-163 — the wallet says what token discovery could and could not do", () => {
  it("renders nothing when the check ran and found nothing", () => {
    expect(html({})).toBe("");
  });

  it("says the network could not be checked when the sync failed", () => {
    expect(html({ syncFailed: true })).toContain("Could not check Base for new tokens");
  });

  it("says the node only answers for known tokens when the sync was limited, without a warning", () => {
    const out = html({ syncLimited: true });
    expect(out).toContain("answer only for tokens this wallet already lists");
    expect(out).not.toContain("Could not check");
    expect(out).not.toContain("warn");
  });

  it("keeps the limited note under a list of arrived tokens", () => {
    const tokens = [{ address: "0x" + "1".repeat(40), symbol: "ABC", name: "Abc", status: "new", readable: true, lookupAttempts: 0 }];
    const out = html({ tokens, syncLimited: true });
    expect(out).toContain("A token arrived");
    expect(out).toContain("answer only for tokens this wallet already lists");
  });
});
