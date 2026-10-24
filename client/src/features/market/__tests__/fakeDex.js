import { ethers } from "ethers";

export const CHAIN_ID = 84532;
export const ROUTER = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
export const QUOTER = "0xC5290058841028F1614F3A6F0F5816cAd0df5E27";
export const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const WETH = "0x4200000000000000000000000000000000000006";
export const TRAP = "0x00000000000000000000000000000000000000AB";
export const FROM = "0x1111111111111111111111111111111111111111";

export const CHAIN = {
  chainId: CHAIN_ID,
  name: "Base Sepolia",
  testnet: true,
  dex: { router: ROUTER, quoter: QUOTER, feeTiers: [100, 500, 3000, 10000] },
  wrappedNative: { symbol: "WETH", address: WETH, decimals: 18 },
  tokens: [
    { symbol: "USDC", address: USDC, decimals: 6 },
    { symbol: "WETH", address: WETH, decimals: 18 },
  ],
};

export const CASH = CHAIN.tokens[0];
export const VERIFIED = CHAIN.tokens[1];
export const UNVERIFIED = { symbol: "TRAP", address: TRAP, decimals: 18, provenance: "coingecko" };

const erc20 = new ethers.Interface([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const quoter = new ethers.Interface([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);
const router = new ethers.Interface([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
  "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum)) payable returns (uint256 amountOut)",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
]);

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const word = (n) => ethers.toBeHex(n, 32);

const TOKENS_PER_USDC = 10n ** 12n * 4n;

function poolOut(tokenIn, amountIn) {
  return same(tokenIn, USDC) ? amountIn * TOKENS_PER_USDC : amountIn / TOKENS_PER_USDC;
}

export function fakeDex({
  allowance = 10n ** 30n,
  cashBalance = 1_000_000_000n,
  simulate = true,
  sellable = true,
  transferFeeBps = 0n,
  plainCallReverts = false,
  approveReverts = false,
} = {}) {
  const events = [];
  const simulations = [];

  function revert(message) {
    return { error: { code: 3, message: `execution reverted: ${message}`, data: "0x" } };
  }

  function quote(data) {
    const parsed = quoter.parseTransaction({ data });
    if (parsed.name === "quoteExactInput") return revert("no route");
    const p = parsed.args[0];
    if (Number(p.fee) !== 500) return revert("no pool");
    const out = poolOut(p.tokenIn, p.amountIn);
    return { result: ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint160", "uint32", "uint256"], [out, 0n, 1, 100000n]) };
  }

  function runSimulation(calls) {
    const balances = new Map([[USDC.toLowerCase(), cashBalance]]);
    const get = (t) => balances.get(String(t).toLowerCase()) || 0n;
    const set = (t, v) => balances.set(String(t).toLowerCase(), v);
    return calls.map((c) => {
      const sel = String(c.data).slice(0, 10);
      if (sel === erc20.getFunction("approve").selector) {
        if (approveReverts && same(c.to, USDC)) return { status: "0x0", returnData: "0x", gasUsed: "0x1", error: { code: 3, message: "execution reverted" } };
        return { status: "0x1", returnData: word(1n), gasUsed: "0x1", logs: [] };
      }
      if (sel === erc20.getFunction("balanceOf").selector) return { status: "0x1", returnData: word(get(c.to)), gasUsed: "0x1", logs: [] };
      if (same(c.to, ROUTER)) {
        const outer = router.decodeFunctionData("multicall", c.data);
        const inner = router.parseTransaction({ data: outer[1][0] });
        const p = inner.args[0];
        const tokenIn = inner.name === "exactInputSingle" ? p.tokenIn : ethers.getAddress(ethers.dataSlice(p.path, 0, 20));
        const amountIn = p.amountIn;
        if (get(tokenIn) < amountIn) return { status: "0x0", returnData: "0x", gasUsed: "0x1", error: { code: 3, message: "execution reverted: STF" } };
        if (!same(tokenIn, USDC) && !sellable) {
          return { status: "0x0", returnData: "0x", gasUsed: "0x1", error: { code: 3, message: "execution reverted: TRANSFER_FROM_FAILED" } };
        }
        const tokenOut = same(tokenIn, USDC) ? (inner.name === "exactInputSingle" ? p.tokenOut : ethers.getAddress(ethers.dataSlice(p.path, ethers.dataLength(p.path) - 20))) : USDC;
        const gross = poolOut(tokenIn, amountIn);
        const delivered = same(tokenOut, USDC) ? gross : gross - (gross * transferFeeBps) / 10000n;
        set(tokenIn, get(tokenIn) - amountIn);
        set(tokenOut, get(tokenOut) + delivered);
        return { status: "0x1", returnData: "0x", gasUsed: "0x1", logs: [] };
      }
      return { status: "0x0", returnData: "0x", gasUsed: "0x1", error: { code: -32015, message: "unknown call" } };
    });
  }

  function handle(method, params) {
    events.push(method);
    switch (method) {
      case "eth_chainId":
        return { result: ethers.toQuantity(CHAIN_ID) };
      case "eth_blockNumber":
        return { result: "0x64" };
      case "eth_getBalance":
        return { result: ethers.toQuantity(10n ** 18n) };
      case "eth_estimateGas":
        return { result: "0x30d40" };
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        return { result: "0x3b9aca00" };
      case "eth_getBlockByNumber":
        return {
          result: {
            hash: word(100n),
            parentHash: word(0n),
            number: "0x64",
            timestamp: ethers.toQuantity(Math.floor(Date.now() / 1000)),
            nonce: "0x0000000000000000",
            difficulty: "0x0",
            gasLimit: "0x1c9c380",
            gasUsed: "0x0",
            miner: ethers.ZeroAddress,
            extraData: "0x",
            baseFeePerGas: "0x3b9aca00",
            transactions: [],
          },
        };
      case "eth_call": {
        const [tx] = params;
        if (same(tx.to, QUOTER)) return quote(tx.data);
        if (same(tx.to, ROUTER)) {
          events.push("plain-swap-check");
          return plainCallReverts ? revert("STF") : { result: "0x" };
        }
        const sel = String(tx.data).slice(0, 10);
        if (sel === erc20.getFunction("balanceOf").selector) return { result: word(same(tx.to, USDC) ? cashBalance : 0n) };
        if (sel === erc20.getFunction("allowance").selector) return { result: word(allowance) };
        return revert("unexpected call");
      }
      case "eth_simulateV1": {
        if (!simulate) return { error: { code: -32601, message: "the method eth_simulateV1 does not exist/is not available" } };
        const calls = params[0].blockStateCalls[0].calls;
        simulations.push(calls);
        return { result: [{ number: "0x65", calls: runSimulation(calls) }] };
      }
      default:
        return { error: { code: -32601, message: `the method ${method} does not exist/is not available` } };
    }
  }

  const req = new ethers.FetchRequest("http://chain.test/rpc");
  req.getUrlFunc = async (r) => {
    const payload = JSON.parse(ethers.toUtf8String(r.body));
    const out = handle(payload.method, payload.params);
    const body = out.error
      ? { jsonrpc: "2.0", id: payload.id, error: out.error }
      : { jsonrpc: "2.0", id: payload.id, result: out.result };
    return {
      statusCode: 200,
      statusMessage: "OK",
      headers: { "content-type": "application/json" },
      body: ethers.toUtf8Bytes(JSON.stringify(body)),
    };
  };
  const provider = new ethers.JsonRpcProvider(req, CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 });
  return { provider, events, simulations, interfaces: { erc20, router } };
}
