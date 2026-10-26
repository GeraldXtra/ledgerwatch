import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { DISPLAY_CURRENCIES, currencyOf } from "../currencies";
import { convertUsd, fallbackNote, formatMoney, resolveDisplay } from "../money";
import LiveBalanceView from "../../market/LiveBalanceView";
import { depositPhrase, depositTokensFor, liveTotal, visibleLiveRows } from "../../market/liveBalances";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDT = "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2";
const WETH = "0x4200000000000000000000000000000000000006";
const ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

const BASE = {
  chainId: 8453,
  name: "Base",
  nativeSymbol: "ETH",
  stables: [
    { symbol: "USDC", address: USDC, decimals: 6 },
    { symbol: "USDT", address: USDT, decimals: 6 },
  ],
  tokens: [
    { symbol: "USDC", address: USDC, decimals: 6 },
    { symbol: "USDT", address: USDT, decimals: 6 },
    { symbol: "WETH", address: WETH, decimals: 18 },
  ],
};

const USD = resolveDisplay("USD", null);
const money = (display = USD) => ({
  format: (usd, opts) => formatMoney(usd, display, opts),
  note: fallbackNote(display),
});

const PRICES = { USDC: 1, USDT: 1, ETH: 3000, WETH: 3000 };
const priceFor = (symbol) => (symbol in PRICES ? PRICES[symbol] : null);

function rows({ native = 0, usdc = 0, usdt = 0, weth = 0, unknown = [] } = {}) {
  const make = (symbol, address, qty, extra = {}) =>
    unknown.includes(symbol)
      ? { symbol, address, qty: null, unknown: true, reason: "timeout", ...extra }
      : { symbol, address, qty, ...extra };
  return [
    make("ETH", null, native, { native: true }),
    make("USDC", USDC, usdc),
    make("USDT", USDT, usdt),
    make("WETH", WETH, weth),
  ];
}

function render(props) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <LiveBalanceView chain={BASE} address={ADDRESS} priceFor={priceFor} money={money()} onCopy={() => {}} {...props} />
    </MemoryRouter>
  );
}

describe("LW-157 — money is formatted in the chosen currency with Intl", () => {
  it("formats US dollars with the dollar sign", () => {
    expect(formatMoney(0, USD)).toBe("$0.00");
    expect(formatMoney(1234.5, USD)).toBe("$1,234.50");
  });

  it("converts and formats naira, euro and yen with their own symbols and decimals", () => {
    const ngn = resolveDisplay("NGN", { NGN: 1600 });
    expect(ngn).toMatchObject({ currency: "NGN", rate: 1600, fellBack: false });
    expect(formatMoney(1234.5, ngn)).toBe("₦1,975,200.00");
    expect(formatMoney(10, resolveDisplay("EUR", { EUR: 0.9 }))).toBe("€9.00");
    expect(formatMoney(10, resolveDisplay("JPY", { JPY: 150 }))).toBe("¥1,500");
    expect(formatMoney(10, resolveDisplay("CAD", { CAD: 1.4 }))).toBe("CA$14.00");
  });

  it("gives small prices more decimals and signs a profit or a loss", () => {
    expect(formatMoney(0.0012345, USD, { price: true })).toBe("$0.001235");
    expect(formatMoney(0.5, USD, { price: true })).toBe("$0.50");
    expect(formatMoney(5, USD, { signed: true })).toBe("+$5.00");
    expect(formatMoney(-5, USD, { signed: true })).toBe("-$5.00");
    expect(formatMoney(0, USD, { signed: true })).toBe("$0.00");
  });

  it("shows a missing value as a dash, never as zero", () => {
    expect(formatMoney(null, USD)).toBe("--");
    expect(formatMoney(NaN, USD)).toBe("--");
    expect(convertUsd(undefined, USD)).toBe(null);
  });
});

describe("LW-157 — without a rate the display falls back to US dollars and says so", () => {
  it("falls back when the rate is missing, zero or not a number", () => {
    for (const rates of [null, {}, { NGN: 0 }, { NGN: "abc" }, { NGN: -3 }]) {
      const d = resolveDisplay("NGN", rates);
      expect(d).toMatchObject({ currency: "USD", wanted: "NGN", rate: 1, fellBack: true });
      expect(formatMoney(2, d)).toBe("$2.00");
      expect(fallbackNote(d)).toMatch(/Nigerian naira rate could not be loaded.*US dollars/);
    }
  });

  it("treats an unknown preference as US dollars without a warning", () => {
    expect(resolveDisplay("XYZ", { XYZ: 3 })).toMatchObject({ currency: "USD", fellBack: false });
    expect(currencyOf({ displayCurrency: "xyz" })).toBe("USD");
    expect(currencyOf({ displayCurrency: "NGN" })).toBe("NGN");
    expect(currencyOf(null)).toBe("USD");
  });

  it("offers exactly the currencies the server accepts", () => {
    const serverFile = fs.readFileSync(
      fileURLToPath(new URL("../../../../../server/src/utils/displayCurrency.js", import.meta.url)),
      "utf8"
    );
    const listed = [...serverFile.matchAll(/^\s+"([A-Z]{3})",$/gm)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThan(10);
    expect(DISPLAY_CURRENCIES.map((c) => c.code)).toEqual(listed);
  });
});

describe("LW-157 — the live balance is always shown, with USDC and USDT listed", () => {
  it("shows $0.00 and both deposit coins for an empty wallet, and no QR code", () => {
    const html = render({ rows: rows() });
    expect(html).toContain("$0.00");
    expect(html).toContain('data-symbol="USDC"');
    expect(html).toContain('data-symbol="USDT"');
    expect(html).not.toContain('data-symbol="WETH"');
    expect(html).not.toContain('data-symbol="ETH"');
    expect(html).not.toMatch(/<img|QR/i);
    expect(html).toMatch(/Deposit <strong>USDC or USDT<\/strong> on <strong>Base<\/strong>/);
    expect(html).toContain("/app/wallet?open=receive&amp;chain=8453");
    expect(html).toContain("0x12345678...12345678");
  });

  it("adds up what is held, the native coin included, in the chosen currency", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LiveBalanceView
          chain={BASE}
          address={ADDRESS}
          rows={rows({ native: 0.01, usdc: 20, weth: 0.5 })}
          priceFor={priceFor}
          money={money(resolveDisplay("NGN", { NGN: 1600 }))}
          onCopy={() => {}}
        />
      </MemoryRouter>
    );
    expect(html).toContain("₦2,480,000.00");
    expect(html).toContain('data-symbol="ETH"');
    expect(html).toContain('data-symbol="WETH"');
  });

  it("never turns a failed read into a zero", () => {
    const html = render({ rows: rows({ unknown: ["ETH", "USDC", "USDT", "WETH"] }) });
    expect(html).not.toContain("$0.00");
    expect(html).toContain("could not be read");
    expect(html).toContain("connection problem rather than a");
    const errored = render({ rows: [], loadError: "the network did not answer" });
    expect(errored).not.toContain("$0.00");
    expect(errored).toContain("the network did not answer");
  });

  it("totals what was read and names what was not", () => {
    const html = render({ rows: rows({ usdt: 5, unknown: ["USDC"] }) });
    expect(html).toContain("$5.00");
    expect(html).toContain("Excludes USDC");
    const total = liveTotal(rows({ usdt: 5, unknown: ["USDC"] }), priceFor);
    expect(total).toMatchObject({ usd: 5, unread: ["USDC"], allFailed: false });
  });

  it("says a holding with no price is left out instead of counting it as nothing", () => {
    const total = liveTotal([{ symbol: "ODD", address: "0x1", qty: 4 }], priceFor);
    expect(total).toMatchObject({ usd: 0, unpriced: ["ODD"] });
  });

  it("puts the deposit coins first and names the chain's own tickers", () => {
    const arbitrum = {
      chainId: 42161,
      name: "Arbitrum One",
      stables: [
        { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
        { symbol: "USD₮0", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
      ],
    };
    expect(depositPhrase(depositTokensFor(arbitrum))).toBe("USDC or USD₮0");
    const order = visibleLiveRows(rows({ native: 1, weth: 2 }), BASE).map((r) => r.symbol);
    expect(order).toEqual(["USDC", "USDT", "ETH", "WETH"]);
  });
});
