import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import { encodePath, buildSwapTx, minOut } from "../dex";

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

const ROUTER = new ethers.Interface([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)",
  "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum)) payable returns (uint256)",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[])",
]);

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
    expect(path.slice(42, 48)).toBe("000bb8");
    expect(path.slice(48)).toBe(PEPE.slice(2).toLowerCase());
  });

  it("lays out a three token path as 20 + 3 + 20 + 3 + 20 bytes", () => {
    const path = encodePath([USDC, WETH, PEPE], [500, 3000]);
    expect((path.length - 2) / 2).toBe(66);
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
    expect(call.args[0].path).toBe(encodePath(route.tokens, route.fees));
    expect(call.args[0].recipient).toBe(RECIPIENT);
    expect(call.args[0].amountIn).toBe(AMOUNT);
    expect(call.args[0].amountOutMinimum).toBe(7n);
  });

  it("still carries a deadline, so a swap expires instead of resting in the mempool", () => {
    const quote = { fee: 500, fees: [500, 3000], via: "WETH", route: { tokens: [USDC, WETH, PEPE], fees: [500, 3000] } };
    const tx = buildSwapTx({ chain: CHAIN, quote, amountIn: AMOUNT, amountOutMinimum: 1n, recipient: RECIPIENT });
    expect(tx.data.slice(0, 10)).toBe("0x5ae401dc");
    const call = decodeSwap(tx);
    const now = BigInt(Math.floor(Date.now() / 1000));
    expect(call.deadline).toBeGreaterThan(now);
    expect(call.deadline).toBeLessThanOrEqual(now + 1300n);
    expect(tx.to).toBe(CHAIN.dex.router);
  });

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
