import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import { encodePath, buildSwapTx, minOut } from "../dex";

/**
 * MULTI-HOP ROUTING — the swap that is signed must be the swap that was priced.
 *
 * Quoting only the direct pair was not a missing feature, it was a wrong price.
 * Measured against Ethereum with 1,000 USDC while this was written:
 *
 *   PEPE   direct 132,499,302   via WETH 275,538,619   the hop pays 2.08x
 *   SHIB   direct 102,858,254   via WETH 180,931,591   the hop pays 1.76x
 *   cbBTC (Base) direct 0.012597  via WETH 0.012592    the DIRECT route wins
 *
 * A buyer taking the direct PEPE quote received less than half of what the
 * market was offering, from a transaction that succeeded and a history row that
 * read "confirmed". Most tokens are paired against the chain's wrapped native
 * rather than against a dollar; the thin direct pool exists, answers, and prices
 * badly. cbBTC is why both are always compared instead of preferring the hop.
 *
 * These tests do not touch a network. They guard the two things that can be
 * wrong without anything appearing wrong: the bytes of the path, and whether
 * the ENCODED CALL matches the route the quote was measured on. Encoding a
 * direct swap for a price quoted through the wrapped native would sign a trade
 * at a price nobody quoted, and on PEPE that is a factor of two.
 */

const CHAIN = {
  name: "Ethereum",
  chainId: 1,
  dex: {
    router: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
    feeTiers: [100, 500, 3000, 10000],
  },
  wrappedNative: { symbol: "WETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
};

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH = CHAIN.wrappedNative.address;
const PEPE = "0x6982508145454ce325ddbe47a25d4ec3d2311933";
const RECIPIENT = "0x1111111111111111111111111111111111111111";

// SwapRouter02, as the router itself decodes them.
const ROUTER = new ethers.Interface([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)",
  "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum)) payable returns (uint256)",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[])",
]);

/** Unwrap multicall(deadline, [inner]) back to the call the router will run. */
function decodeSwap(tx) {
  const outer = ROUTER.decodeFunctionData("multicall", tx.data);
  expect(outer[1]).toHaveLength(1);
  const inner = outer[1][0];
  const fragment = ROUTER.getFunction(inner.slice(0, 10));
  return { deadline: outer[0], name: fragment.name, args: ROUTER.decodeFunctionData(fragment, inner) };
}

const AMOUNT = 1000n * 10n ** 6n;

describe("Uniswap V3 path encoding", () => {
  it("lays out a two token path as 20 + 3 + 20 bytes", () => {
    const path = encodePath([USDC, PEPE], [3000]);
    expect((path.length - 2) / 2).toBe(43);
    expect(path.slice(2, 42)).toBe(USDC.slice(2).toLowerCase());
    // uint24 is exactly three bytes, big endian. 3000 == 0x000bb8.
    expect(path.slice(42, 48)).toBe("000bb8");
    expect(path.slice(48)).toBe(PEPE.slice(2).toLowerCase());
  });

  it("lays out a three token path as 20 + 3 + 20 + 3 + 20 bytes", () => {
    const path = encodePath([USDC, WETH, PEPE], [500, 3000]);
    expect((path.length - 2) / 2).toBe(66);
    // 500 == 0x0001f4. A fee written in fewer than three bytes shifts every
    // address after it and produces a path the router cannot parse.
    expect(path.slice(42, 48)).toBe("0001f4");
    expect(path.slice(88, 94)).toBe("000bb8");
  });

  it("refuses a path whose fees and tokens do not line up", () => {
    expect(() => encodePath([USDC, WETH, PEPE], [500])).toThrow(/one fee between each pair/i);
  });
});

describe("the encoded swap follows the quoted route", () => {
  it("encodes exactInputSingle for a direct quote", () => {
    const quote = { fee: 3000, fees: [3000], via: null, route: { tokens: [USDC, PEPE], fees: [3000] } };
    const tx = buildSwapTx({ chain: CHAIN, quote, amountIn: AMOUNT, amountOutMinimum: 1n, recipient: RECIPIENT });
    const call = decodeSwap(tx);
    expect(call.name).toBe("exactInputSingle");
    // Checksummed on the way back out of the decoder, so compared in that form.
    expect(call.args[0].tokenIn).toBe(ethers.getAddress(USDC));
    expect(call.args[0].tokenOut).toBe(ethers.getAddress(PEPE));
    expect(call.args[0].fee).toBe(3000n);
  });

  it("encodes exactInput with the SAME path a hop quote was measured on", () => {
    const route = { tokens: [USDC, WETH, PEPE], fees: [500, 3000] };
    const quote = { fee: 500, fees: [500, 3000], via: "WETH", route };
    const tx = buildSwapTx({ chain: CHAIN, quote, amountIn: AMOUNT, amountOutMinimum: 7n, recipient: RECIPIENT });
    const call = decodeSwap(tx);
    expect(call.name).toBe("exactInput");
    // The bytes the router receives are the bytes the quoter was asked about.
    expect(call.args[0].path).toBe(encodePath(route.tokens, route.fees));
    expect(call.args[0].recipient).toBe(RECIPIENT);
    expect(call.args[0].amountIn).toBe(AMOUNT);
    expect(call.args[0].amountOutMinimum).toBe(7n);
  });

  it("still carries a deadline, so a swap expires instead of resting in the mempool", () => {
    const quote = { fee: 500, fees: [500, 3000], via: "WETH", route: { tokens: [USDC, WETH, PEPE], fees: [500, 3000] } };
    const tx = buildSwapTx({ chain: CHAIN, quote, amountIn: AMOUNT, amountOutMinimum: 1n, recipient: RECIPIENT });
    // 0x5ae401dc is multicall(uint256,bytes[]). A bare exactInput would have no
    // expiry at all, which is the standing-order defect LW-068 closed.
    expect(tx.data.slice(0, 10)).toBe("0x5ae401dc");
    const call = decodeSwap(tx);
    const now = BigInt(Math.floor(Date.now() / 1000));
    expect(call.deadline).toBeGreaterThan(now);
    expect(call.deadline).toBeLessThanOrEqual(now + 1300n);
    expect(tx.to).toBe(CHAIN.dex.router);
  });

  /**
   * THE GUARD ON THE ENDS OF THE ROUTE HAD NO TEST.
   *
   * `buildSwapTx` refuses a quote whose route does not start and end at the
   * tokens the plan is about, and its own comment says that exists so "a later
   * refactor that threads a stale or mismatched quote through here fails loudly
   * instead of encoding a swap that spends the wrong token". Every test called
   * it without `tokenIn`/`tokenOut`, so the branch was never entered and the
   * guard could have been deleted by a refactor with nothing going red. It sits
   * on the function whose output is signed.
   */
  it("refuses a quote whose route starts at a different token from the one being spent", () => {
    const quote = { fee: 3000, fees: [3000], via: null, route: { tokens: [WETH, PEPE], fees: [3000] } };
    expect(() =>
      buildSwapTx({
        chain: CHAIN,
        quote,
        amountIn: AMOUNT,
        amountOutMinimum: 1n,
        recipient: RECIPIENT,
        tokenIn: USDC,
        tokenOut: PEPE,
      })
    ).toThrow(/different token than the one being spent/i);
  });

  it("refuses a quote whose route ends at a different token from the one being bought", () => {
    const quote = { fee: 3000, fees: [3000], via: null, route: { tokens: [USDC, WETH], fees: [3000] } };
    expect(() =>
      buildSwapTx({
        chain: CHAIN,
        quote,
        amountIn: AMOUNT,
        amountOutMinimum: 1n,
        recipient: RECIPIENT,
        tokenIn: USDC,
        tokenOut: PEPE,
      })
    ).toThrow(/different token than the one being bought/i);
  });

  it("accepts a matching route whatever case the addresses are written in", () => {
    // The registry, the coin index and the quoter do not agree on checksum
    // casing, so the comparison has to be case insensitive or the guard would
    // reject correct quotes instead of wrong ones.
    const route = { tokens: [USDC, WETH, PEPE], fees: [500, 3000] };
    const quote = { fee: 500, fees: [500, 3000], via: "WETH", route };
    const tx = buildSwapTx({
      chain: CHAIN,
      quote,
      amountIn: AMOUNT,
      amountOutMinimum: 1n,
      recipient: RECIPIENT,
      tokenIn: USDC.toLowerCase(),
      tokenOut: ethers.getAddress(PEPE),
    });
    expect(decodeSwap(tx).name).toBe("exactInput");
  });

  it("refuses to build a swap with no route, rather than assuming a direct one", () => {
    // A quote without a route means the price came from somewhere unknown.
    // Guessing "direct" here is exactly how a hop-priced trade would be signed
    // against a pool that cannot fill it.
    expect(() =>
      buildSwapTx({ chain: CHAIN, quote: { fee: 3000 }, amountIn: AMOUNT, amountOutMinimum: 1n, recipient: RECIPIENT })
    ).toThrow(/route/i);
  });
});

describe("minOut still bounds what the router will accept", () => {
  it("takes the slippage off the quote", () => {
    expect(minOut(1_000_000n, 1)).toBe(990_000n);
    expect(minOut(1_000_000n, 0.5)).toBe(995_000n);
  });

  it("clamps a nonsensical slippage rather than letting it through", () => {
    expect(minOut(1_000_000n, -5)).toBe(1_000_000n);
    expect(minOut(1_000_000n, 999)).toBe(500_000n);
  });
});
