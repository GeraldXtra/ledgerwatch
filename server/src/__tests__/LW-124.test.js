const User = require("../models/User");
const { defaultChainId } = require("../controllers/wallet.controller");
const publicUser = require("../utils/publicUser");

const original = process.env.ENABLE_MAINNET;

afterEach(() => {
  if (original === undefined) delete process.env.ENABLE_MAINNET;
  else process.env.ENABLE_MAINNET = original;
});

let seq = 0;
const anEmail = () => `lw124-${Date.now()}-${++seq}@example.com`;

describe("LW-124 — a new account starts on a mainnet when mainnet is enabled", () => {
  it("tells the wallet to open on Base when mainnet is on", () => {
    process.env.ENABLE_MAINNET = "true";
    expect(defaultChainId()).toBe(8453);
  });

  it("falls back to Base Sepolia when mainnet is off", () => {
    process.env.ENABLE_MAINNET = "false";
    expect(defaultChainId()).toBe(84532);
  });

  it("issues a new account's invoice payments on Base when mainnet is on", async () => {
    process.env.ENABLE_MAINNET = "true";
    const user = await User.create({ name: "New", email: anEmail(), passwordHash: "x" });
    expect(user.crypto.defaultChainId).toBe(8453);
    expect(publicUser(user).crypto.defaultChainId).toBe(8453);
  });

  it("keeps a testnet default when mainnet is off", async () => {
    process.env.ENABLE_MAINNET = "false";
    const user = await User.create({ name: "New", email: anEmail(), passwordHash: "x" });
    expect(user.crypto.defaultChainId).toBe(84532);
  });

  it("does not move an account that already chose a network", async () => {
    process.env.ENABLE_MAINNET = "true";
    const user = await User.create({ name: "Old", email: anEmail(), passwordHash: "x", crypto: { defaultChainId: 137 } });
    expect(user.crypto.defaultChainId).toBe(137);
  });
});
