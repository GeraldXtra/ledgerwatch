const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "../../..");

describe("invariant 4 — the RPC proxy allowlist contains no signing method", () => {
  const { ALLOWED_METHODS } = require("../controllers/wallet.controller");

  const FORBIDDEN = [
    "eth_sign",
    "eth_signTransaction",
    "eth_signTypedData",
    "eth_signTypedData_v3",
    "eth_signTypedData_v4",
    "personal_sign",
    "personal_ecRecover",
    "personal_unlockAccount",
    "eth_accounts",
    "eth_requestAccounts",
    "eth_sendTransaction",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
    "wallet_requestPermissions",
    "miner_start",
    "admin_addPeer",
    "debug_traceTransaction",
  ];

  it("is a Set, so membership cannot be faked by a prototype property", () => {
    expect(ALLOWED_METHODS).toBeInstanceOf(Set);
  });

  it.each(FORBIDDEN)("does not allow %s", (method) => {
    expect(ALLOWED_METHODS.has(method)).toBe(false);
  });

  it("allows no method whose name suggests signing, accounts or administration", () => {
    const suspicious = [...ALLOWED_METHODS].filter((m) =>
      /sign|account|unlock|personal_|miner_|admin_|debug_|txpool_/i.test(m)
    );
    expect(suspicious).toEqual([]);
  });

  it("allows eth_sendRawTransaction, and ONLY that as a write", () => {
    expect(ALLOWED_METHODS.has("eth_sendRawTransaction")).toBe(true);

    const writes = [...ALLOWED_METHODS].filter((m) => /^eth_send/.test(m));
    expect(writes).toEqual(["eth_sendRawTransaction"]);
  });

  it("has not grown beyond the reviewed surface without this test being updated", () => {
    expect(ALLOWED_METHODS.size).toBeLessThanOrEqual(20);
  });
});

describe("derivation parity — the server and the browser must agree exactly", () => {
  const server = require("../config/derivation");
  const clientPath = path.join(REPO, "client/src/features/wallet/derivation.js");
  const clientSrc = fs.readFileSync(clientPath, "utf8");

  it("the client file still exists where the server's header says it does", () => {
    expect(fs.existsSync(clientPath)).toBe(true);
  });

  it("declares the same receivables branch on both sides", () => {
    const match = clientSrc.match(
      /RECEIVABLES_BRANCH\s*=\s*(["'`])((?:(?!\1).)*)\1/
    );
    expect(match, "RECEIVABLES_BRANCH not found in the client file").toBeTruthy();
    expect(match[2]).toBe(server.RECEIVABLES_BRANCH);
  });

  it("the branch is the one the whole product was built around", () => {
    expect(server.RECEIVABLES_BRANCH).toBe("m/44'/60'/0'/2");
  });

  it("builds the same full path for the same index", () => {
    expect(clientSrc).toMatch(
      /return\s*`\$\{RECEIVABLES_BRANCH\}\/\$\{index\}`/
    );
    for (const i of [0, 1, 7, 42, 1000]) {
      expect(server.pathForIndex(i)).toBe(`m/44'/60'/0'/2/${i}`);
    }
  });

  it("refuses a non-integer or negative index on the server side", () => {
    for (const bad of [-1, 1.5, "3", null, undefined, NaN]) {
      expect(() => server.pathForIndex(bad)).toThrow();
    }
  });

  it("the client refuses the same inputs", () => {
    expect(clientSrc).toMatch(/Number\.isInteger\(index\)/);
    expect(clientSrc).toMatch(/index\s*<\s*0/);
  });
});

describe("invariant 19 — no secret material in the repository", () => {
  const { execSync } = require("child_process");

  function tracked(pattern) {
    try {
      const out = execSync(`git ls-files -- "${pattern}"`, {
        cwd: REPO,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return out.trim().split("\n").filter(Boolean);
    } catch {
      return null;
    }
  }

  it("does not track the directory that leaked in LW-001", () => {
    const hits = tracked("acccountSecretPhrase/**");
    if (hits === null) return;
    expect(hits).toEqual([]);
  });

  it.each(["*.seed", "*.mnemonic", "*secret*phrase*", "keystore*.json"])(
    "does not track %s",
    (pattern) => {
      const hits = tracked(pattern);
      if (hits === null) return;
      expect(hits).toEqual([]);
    }
  );

  it("does not track a .env anywhere", () => {
    const hits = tracked("**/.env");
    if (hits === null) return;
    expect(hits).toEqual([]);
  });
});
