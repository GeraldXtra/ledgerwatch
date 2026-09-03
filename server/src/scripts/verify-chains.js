/**
 * VERIFY THE CHAIN REGISTRY AGAINST THE LIVE CHAINS.
 *
 * The registry's own header makes a promise:
 *
 *     "EVERY ADDRESS BELOW WAS VERIFIED AGAINST THE LIVE CHAIN, not from memory."
 *
 * That promise was kept for the five testnets and explicitly NOT kept for the
 * seven mainnets, which the file says were "single-entry: they are disabled, so
 * none of these were put through the fallback verification the testnets got".
 *
 * This script is what makes the promise checkable rather than asserted, and it
 * is a precondition for turning mainnet on. On a testnet a wrong address costs
 * nothing. On mainnet it moves real money to somewhere nobody controls.
 *
 * For every chain it checks:
 *   1. every RPC endpoint answers eth_chainId with the CORRECT id
 *      (an endpoint quietly pointing at another network would broadcast a
 *      signed transaction onto the wrong chain)
 *   2. every token contract's own symbol() and decimals() match what is written
 *   3. every router and quoter has real bytecode at its address
 *   4. a filtered eth_getLogs at the configured span is accepted, within the
 *      timeout the watchers actually use
 *
 * Usage:
 *   node src/scripts/verify-chains.js                 all chains
 *   node src/scripts/verify-chains.js --mainnet       mainnet only
 *   node src/scripts/verify-chains.js --testnet       testnets only
 *   node src/scripts/verify-chains.js --chain=8453    one chain
 *   node src/scripts/verify-chains.js --json          machine readable
 *
 * Exits non-zero if anything fails, so it can gate CI.
 */
require("dotenv").config();
const { allChains, tokensFor } = require("../config/chains");

const ARGS = process.argv.slice(2);
const WANT_MAINNET = ARGS.includes("--mainnet");
const WANT_TESTNET = ARGS.includes("--testnet");
const AS_JSON = ARGS.includes("--json");
const ONE = (ARGS.find((a) => a.startsWith("--chain=")) || "").split("=")[1];

const TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || 12000);

/**
 * A recipient that has never received anything.
 *
 * The probe MUST filter by recipient, because that is what the payment watcher
 * does: `topics: [TRANSFER, null, addressTopic(pa.address)]`. An earlier version
 * of this script filtered on the Transfer topic alone, which on mainnet returns
 * every transfer of that token and trips result-count caps the real query never
 * comes near. It reported six chains as broken that were fine, and it measured
 * the wrong limit on the one that was not. With an empty result set, what is
 * measured is the endpoint's RANGE limit, which is the thing that matters.
 */
const NOBODY = "0x000000000000000000000000dead00000000000000000000000000000000beef";

/** The Transfer topic the payment watcher filters on. */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** Never print a full URL: it carries the Alchemy key. Same rule as rpc.service. */
function host(url) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

/**
 * One attempt. `rpc` below wraps this with a retry, because a public endpoint
 * answering 429 to the third of three concurrent token reads is a rate limit,
 * not a missing contract, and reporting it as a failure is how a verifier trains
 * people to ignore it. Which token 429s rotates run to run; that rotation is
 * exactly what identifies it.
 */
async function rpcOnce(url, method, params = []) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    if (!body) return { ok: false, reason: "unparseable JSON" };
    if (body.error) return { ok: false, reason: `rpc error ${body.error.code}: ${body.error.message}` };
    return { ok: true, result: body.result };
  } catch (err) {
    // undici hides the real cause behind a bare "fetch failed", which is exactly
    // the confusion this project has already been bitten by once.
    const cause = err?.cause?.code || err?.cause?.message;
    return { ok: false, reason: err.name === "AbortError" ? `timeout >${TIMEOUT_MS}ms` : cause || err.message };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isRateLimit = (reason) => /HTTP 429|rate limit|too many/i.test(reason || "");

/** One endpoint, retried once on a rate limit after a pause. */
async function rpc(url, method, params = []) {
  const first = await rpcOnce(url, method, params);
  if (first.ok || !isRateLimit(first.reason)) return first;
  await sleep(1500);
  return rpcOnce(url, method, params);
}

/**
 * Walk the endpoint list the way rpc.service does in production.
 *
 * A 429 is in that service's PRE_ACCEPT_STATUS set, so the real client steps
 * straight to the next endpoint and the read succeeds. A verifier that gives up
 * on the first host reports a failure the running system never experiences:
 * mainnet.base.org rate limits this machine hard, and Base was failing on a
 * different token every run while base.drpc.org served all three happily.
 */
async function rpcAny(urls, method, params = []) {
  let last = { ok: false, reason: "no endpoint" };
  for (const url of urls) {
    last = await rpc(url, method, params);
    if (last.ok) return last;
  }
  return last;
}

/**
 * Decode an ABI-encoded string return.
 *
 * Handles BOTH shapes, because early tokens predate the string convention and
 * return a fixed bytes32. Treating a bytes32 as a dynamic string yields garbage
 * rather than an error, which would read as a symbol mismatch and send somebody
 * hunting for a problem that is not there.
 */
function decodeString(hex) {
  if (!hex || hex === "0x") return null;
  const data = hex.slice(2);
  // bytes32: exactly one word, null padded.
  if (data.length === 64) {
    const bytes = Buffer.from(data, "hex");
    const end = bytes.indexOf(0);
    return bytes.slice(0, end === -1 ? bytes.length : end).toString("utf8").trim() || null;
  }
  // dynamic string: offset word, length word, then the bytes.
  if (data.length < 128) return null;
  const len = parseInt(data.slice(64, 128), 16);
  if (!Number.isFinite(len) || len === 0) return null;
  return Buffer.from(data.slice(128, 128 + len * 2), "hex").toString("utf8").trim();
}

function decodeUint(hex) {
  if (!hex || hex === "0x") return null;
  const n = parseInt(hex, 16);
  return Number.isFinite(n) ? n : null;
}

const SELECTOR = { symbol: "0x95d89b41", decimals: "0x313ce567" };

/** Run promises with a small concurrency cap. */
async function pool(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

async function verifyChain(chain) {
  const findings = [];
  const add = (ok, what, detail) => findings.push({ ok, what, detail });

  // ---- 1. every endpoint, correct chain id ----------------------------------
  const endpoints = await pool(chain.rpcs, 4, async (url) => {
    const r = await rpc(url, "eth_chainId");
    if (!r.ok) return { url, ok: false, reason: r.reason };
    const id = decodeUint(r.result);
    return { url, ok: id === chain.chainId, id, reason: id === chain.chainId ? null : `answered chainId ${id}` };
  });

  endpoints.forEach((e) => {
    add(e.ok, `endpoint ${host(e.url)}`, e.ok ? `chainId ${chain.chainId}` : e.reason);
  });

  const live = endpoints.find((e) => e.ok);
  if (!live) {
    add(false, "usable endpoint", "no endpoint answered with the correct chain id");
    return { chain, findings, reachable: false };
  }
  const url = live.url;

  // ---- 2. every token, read from its own contract ---------------------------
  const tokens = tokensFor(chain);
  /**
   * ONE token at a time, and symbol before decimals rather than both at once.
   *
   * A pool of four, each firing two calls, put eight concurrent requests on a
   * single public host. mainnet.base.org answered 429 to whichever arrived
   * third, and WHICH token failed rotated run to run. That is a self inflicted
   * rate limit reported as a missing contract, and a verifier that produces a
   * false failure is worse than no verifier, because the next real one gets
   * waved away too. Base USDT was read directly off both endpoints to confirm
   * the address was never the problem.
   */
  const liveUrls = endpoints.filter((e) => e.ok).map((e) => e.url);
  await pool(tokens, 1, async (t) => {
    const sym = await rpcAny(liveUrls, "eth_call", [{ to: t.address, data: SELECTOR.symbol }, "latest"]);
    const dec = await rpcAny(liveUrls, "eth_call", [{ to: t.address, data: SELECTOR.decimals }, "latest"]);

    if (!sym.ok || !dec.ok) {
      add(false, `token ${t.symbol}`, `could not read contract: ${sym.reason || dec.reason}`);
      return;
    }
    const onChainSymbol = decodeString(sym.result);
    const onChainDecimals = decodeUint(dec.result);

    if (onChainSymbol === null && onChainDecimals === null) {
      add(false, `token ${t.symbol}`, `nothing at ${t.address} on this chain`);
      return;
    }
    const symbolMatches = onChainSymbol === t.symbol;
    const decimalsMatch = onChainDecimals === t.decimals;
    add(
      symbolMatches && decimalsMatch,
      `token ${t.symbol}`,
      symbolMatches && decimalsMatch
        ? `${onChainSymbol}, ${onChainDecimals} decimals`
        : `registry says ${t.symbol}/${t.decimals}, chain says ${onChainSymbol}/${onChainDecimals}`
    );
  });

  // ---- 3. router and quoter carry real bytecode -----------------------------
  if (chain.dex) {
    for (const [role, address] of [
      ["router", chain.dex.router],
      ["quoter", chain.dex.quoter],
    ]) {
      const r = await rpcAny(liveUrls, "eth_getCode", [address, "latest"]);
      if (!r.ok) {
        add(false, `dex ${role}`, `could not read code: ${r.reason}`);
        continue;
      }
      const size = r.result && r.result !== "0x" ? (r.result.length - 2) / 2 : 0;
      add(size > 0, `dex ${role}`, size > 0 ? `${size} bytes of code` : `NO CODE at ${address}`);
    }
  }

  // ---- 4. a filtered log query at the span the watchers use ------------------
  // The SAME rule the watcher applies: the measured span, capped by the env
  // var if one is set. The two used to differ, so this certified a span the
  // watcher never ran.
  const measured = Number(chain.logSpan) || 1500;
  const cap = Number(process.env.PAYMENT_WATCH_BLOCK_SPAN);
  const span = Number.isFinite(cap) && cap > 0 ? Math.min(measured, cap) : measured;

  /**
   * The log probe runs against EVERY endpoint, not just the first that answers.
   *
   * rpc.service falls through to the next endpoint on any read failure, so a
   * chain is healthy if ANY listed endpoint serves the span. Probing only the
   * first reported Ethereum Sepolia as broken when it was merely leading with
   * Alchemy, whose free tier caps eth_getLogs at a 10 block range and whose 400
   * the client correctly steps past.
   *
   * It is still worth naming the endpoints that refuse: on a chain with one
   * usable log endpoint, that endpoint going down stops payment detection, and
   * that is a fact somebody should know before it happens rather than after.
   */
  const headRes = await rpc(url, "eth_blockNumber");
  if (!headRes.ok) {
    add(false, "eth_getLogs probe", `could not read head: ${headRes.reason}`);
    return { chain, findings, reachable: true };
  }
  const head = decodeUint(headRes.result);
  const from = Math.max(0, head - span);
  const probeToken = tokens[0];

  const logProbes = await pool(endpoints.filter((e) => e.ok), 3, async (e) => {
    const started = Date.now();
    const r = await rpc(e.url, "eth_getLogs", [
      {
        fromBlock: `0x${from.toString(16)}`,
        toBlock: `0x${head.toString(16)}`,
        address: probeToken ? probeToken.address : undefined,
        topics: [TRANSFER_TOPIC, null, NOBODY],
      },
    ]);
    return { host: host(e.url), ok: r.ok, reason: r.reason, ms: Date.now() - started };
  });

  const serving = logProbes.filter((p) => p.ok);
  add(
    serving.length > 0,
    `eth_getLogs over ${span} blocks`,
    serving.length
      ? `${serving.length} of ${logProbes.length} endpoint(s) served it: ${serving
          .map((p) => `${p.host} ${p.ms}ms`)
          .join(", ")}`
      : `NO endpoint served it: ${logProbes.map((p) => `${p.host} ${p.reason}`).join("; ")}`
  );

  /**
   * EVERY ENDPOINT MUST SERVE eth_call, not just the first one that answers.
   *
   * This check exists because rpc.flashbots.net passed every other check in this
   * file and then failed every eth_call with "missing revert data": it is a
   * transaction privacy relay, not a general purpose node. It had been listed
   * FIRST for Ethereum mainnet, where it would have broken token balances,
   * decimals reads, DEX quotes and the watcher's grace balance check while
   * reporting perfect health on chain id, head and log queries.
   *
   * The token reads above use rpcAny, which walks the list and therefore MASKED
   * it. An endpoint that serves most methods and silently fails one is the worst
   * shape there is, so each is now asked individually.
   */
  if (probeToken) {
    const callProbes = await pool(endpoints.filter((e) => e.ok), 2, async (e) => {
      const r = await rpc(e.url, "eth_call", [
        { to: probeToken.address, data: SELECTOR.decimals },
        "latest",
      ]);
      const usable = r.ok && r.result && r.result !== "0x";
      return { host: host(e.url), ok: usable, reason: r.reason || "returned empty data" };
    });
    const calling = callProbes.filter((p) => p.ok);
    add(
      calling.length > 0,
      "eth_call",
      calling.length === callProbes.length
        ? `all ${callProbes.length} endpoint(s) serve it`
        : `${calling.length} of ${callProbes.length}: ${callProbes
            .filter((p) => !p.ok)
            .map((p) => `${p.host} ${p.reason}`)
            .join("; ")}`
    );
    callProbes
      .filter((p) => !p.ok)
      .forEach((p) =>
        add(false, `  ${p.host}`, `CANNOT serve eth_call (${p.reason}). Balances, decimals and quotes fail here.`)
      );
  }

  /**
   * AT LEAST ONE ENDPOINT MUST SERVE eth_getTransactionReceipt.
   *
   * The blind spot that let BNB Chain report 84 of 84 PASS while unable to
   * settle a single payment: its only endpoint refused this one method, the
   * watcher read the refusal as a reorg, and nothing here asked. A real
   * transaction from the head block is used, so a "null" answer would mean the
   * endpoint is lying about the chain, not that the hash was made up.
   */
  {
    const head = await rpcAny(liveUrls, "eth_getBlockByNumber", ["latest", false]);
    const sample = head.ok && head.result && Array.isArray(head.result.transactions)
      ? head.result.transactions[0]
      : null;
    if (!sample) {
      add(false, "eth_getTransactionReceipt", "could not fetch a sample transaction from the head block to probe with");
    } else {
      const receiptProbes = await pool(endpoints.filter((e) => e.ok), 2, async (e) => {
        const r = await rpc(e.url, "eth_getTransactionReceipt", [sample]);
        const usable = r.ok && r.result && typeof r.result === "object";
        const host = e.host || new URL(e.url).hostname;
        return { host, ok: usable, reason: usable ? "" : r.reason || "null receipt for a real transaction" };
      });
      const serving = receiptProbes.filter((p) => p.ok);
      add(
        serving.length > 0,
        "eth_getTransactionReceipt",
        serving.length === receiptProbes.length
          ? `all ${receiptProbes.length} endpoint(s) serve it`
          : serving.length > 0
            ? `${serving.length} of ${receiptProbes.length}: ${receiptProbes.filter((p) => !p.ok).map((p) => `${p.host} ${p.reason}`).join("; ")}`
            : `NO endpoint serves it. Confirmed payments on this chain can never settle: ${receiptProbes.map((p) => `${p.host} ${p.reason}`).join("; ")}`
      );
    }
  }

  // A chain whose log queries rest on a single endpoint is a single point of
  // failure for payment detection. Not a failure, but it must be said.
  if (serving.length === 1 && logProbes.length > 1) {
    add(true, "log redundancy", `ONLY ${serving[0].host} serves log queries here`);
  }
  logProbes
    .filter((p) => !p.ok)
    .forEach((p) => add(true, `  note ${p.host}`, `refuses this span: ${p.reason}`));

  return { chain, findings, reachable: true };
}

(async () => {
  let chains = allChains();
  if (ONE) chains = chains.filter((c) => c.chainId === Number(ONE));
  else if (WANT_MAINNET) chains = chains.filter((c) => !c.testnet);
  else if (WANT_TESTNET) chains = chains.filter((c) => c.testnet);

  if (!chains.length) {
    console.error("No chains matched.");
    process.exit(1);
  }

  const results = [];
  for (const chain of chains) {
    if (!AS_JSON) process.stdout.write(`\n${chain.name} (${chain.chainId})\n`);
    const r = await verifyChain(chain);
    results.push(r);
    if (!AS_JSON) {
      r.findings.forEach((f) => {
        process.stdout.write(`  ${f.ok ? "PASS" : "FAIL"}  ${f.what.padEnd(34)} ${f.detail || ""}\n`);
      });
    }
  }

  const failed = results.filter((r) => r.findings.some((f) => !f.ok));

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        results.map((r) => ({
          chainId: r.chain.chainId,
          name: r.chain.name,
          testnet: r.chain.testnet,
          findings: r.findings,
        })),
        null,
        2
      )
    );
  } else {
    const total = results.reduce((n, r) => n + r.findings.length, 0);
    const bad = results.reduce((n, r) => n + r.findings.filter((f) => !f.ok).length, 0);
    process.stdout.write(`\n${total - bad} of ${total} checks passed across ${results.length} chain(s).\n`);
    if (failed.length) {
      process.stdout.write(`FAILING: ${failed.map((r) => r.chain.name).join(", ")}\n`);
      process.stdout.write(
        "An address that cannot be verified must be ABSENT rather than guessed.\n"
      );
    }
  }

  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error("verify-chains crashed:", err.message);
  process.exit(1);
});
