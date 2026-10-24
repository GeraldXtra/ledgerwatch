import { ethers } from "ethers";

export const CHAIN_ID = 84532;
const ZERO_HASH = `0x${"00".repeat(32)}`;

function block(number) {
  return {
    hash: `0x${number.toString(16).padStart(64, "0")}`,
    parentHash: ZERO_HASH,
    number: ethers.toQuantity(number),
    timestamp: ethers.toQuantity(Math.floor(Date.now() / 1000)),
    nonce: "0x0000000000000000",
    difficulty: "0x0",
    gasLimit: "0x1c9c380",
    gasUsed: "0x0",
    miner: ethers.ZeroAddress,
    extraData: "0x",
    baseFeePerGas: "0x3b9aca00",
    transactions: [],
  };
}

function receipt(hash, status) {
  return {
    to: ethers.ZeroAddress,
    from: ethers.ZeroAddress,
    contractAddress: null,
    transactionIndex: "0x0",
    gasUsed: "0x5208",
    logsBloom: `0x${"00".repeat(256)}`,
    blockHash: `0x${"11".repeat(32)}`,
    transactionHash: hash,
    logs: [],
    blockNumber: "0x64",
    cumulativeGasUsed: "0x5208",
    effectiveGasPrice: "0x3b9aca00",
    status,
    type: "0x2",
  };
}

const ERC20 = new ethers.Interface(["function balanceOf(address) view returns (uint256)"]);

export function fakeChain({ onSend, receiptStatus = () => "0x1", tokenBalance = 0n, events = [] } = {}) {
  const sent = [];
  const req = new ethers.FetchRequest("http://chain.test/rpc");
  req.getUrlFunc = async (r) => {
    const payload = JSON.parse(ethers.toUtf8String(r.body));
    const { method, params } = payload;
    events.push(method);
    const reply = (result) => ({ jsonrpc: "2.0", id: payload.id, result });
    let out;
    switch (method) {
      case "eth_chainId":
        out = reply(ethers.toQuantity(CHAIN_ID));
        break;
      case "eth_blockNumber":
        out = reply("0x64");
        break;
      case "eth_getTransactionCount":
        out = reply(ethers.toQuantity(sent.length));
        break;
      case "eth_estimateGas":
        out = reply("0x5208");
        break;
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas":
        out = reply("0x3b9aca00");
        break;
      case "eth_getBlockByNumber":
        out = reply(block(100));
        break;
      case "eth_getBalance":
        out = reply(ethers.toQuantity(10n ** 18n));
        break;
      case "eth_call": {
        const sel = String(params[0].data || "").slice(0, 10);
        out =
          sel === ERC20.getFunction("balanceOf").selector
            ? reply(ethers.toBeHex(tokenBalance, 32))
            : { jsonrpc: "2.0", id: payload.id, error: { code: 3, message: "execution reverted" } };
        break;
      }
      case "eth_sendRawTransaction": {
        const hash = ethers.keccak256(params[0]);
        const tx = ethers.Transaction.from(params[0]);
        sent.push({ hash, to: tx.to, from: tx.from, value: tx.value, data: tx.data });
        const verdict = onSend ? onSend({ hash, tx, index: sent.length - 1 }) : null;
        if (verdict && verdict.http) {
          return {
            statusCode: verdict.http,
            statusMessage: "Bad Gateway",
            headers: { "content-type": "application/json" },
            body: ethers.toUtf8Bytes(JSON.stringify(verdict.body)),
          };
        }
        out = verdict && verdict.error ? { jsonrpc: "2.0", id: payload.id, error: verdict.error } : reply(hash);
        break;
      }
      case "eth_getTransactionReceipt": {
        const status = receiptStatus(params[0], sent);
        out = reply(status == null ? null : receipt(params[0], status));
        break;
      }
      case "eth_getTransactionByHash":
        out = reply(null);
        break;
      default:
        out = { jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: `the method ${method} does not exist` } };
    }
    return {
      statusCode: 200,
      statusMessage: "OK",
      headers: { "content-type": "application/json" },
      body: ethers.toUtf8Bytes(JSON.stringify(out)),
    };
  };
  const provider = new ethers.JsonRpcProvider(req, CHAIN_ID, { staticNetwork: true, batchMaxCount: 1, pollingInterval: 50 });
  return { provider, sent, events };
}
