/**
 * Test setup — an isolated in-memory MongoDB per test file.
 *
 * WHY THIS EXISTS AT ALL
 *
 * This project had no tests. Its documented, repeated failure mode is silent
 * failure in code that reads as correct: a log query that returned null forever,
 * a cache that latched a failure, an `expired` status nothing ever wrote, a
 * derived field that came back undefined. Two more were found only by querying
 * the database — a confirmed payment that was swept but never credited, and two
 * addresses primed to settle a full balance for one cent. Every one of those is
 * trivially caught by a test and invisible to review. That is what this harness
 * is for.
 *
 * SAFETY
 *
 * The real development database lives at mongodb://127.0.0.1:27017/ledgerwatch
 * and holds real rows, including the unrecorded 7.35 USDC payment that LW-002
 * exists to explain. Tests MUST NEVER touch it. `MongoMemoryServer` binds an
 * ephemeral port and a throwaway data directory, and the guard below refuses to
 * run if anything has pointed mongoose at a non-ephemeral host.
 */

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

/**
 * Use an already-installed mongod instead of downloading one.
 *
 * mongodb-memory-server otherwise fetches a ~781 MB MongoDB archive on first
 * run. On the machine this was written on that download managed 3 MB in two
 * minutes, which works out at roughly eight hours, so the suite was unrunnable.
 * A local server was already installed, and pointing at its binary gives exactly
 * the same isolation — MongoMemoryServer still starts its own process on an
 * ephemeral port with a throwaway data directory — with no network at all.
 *
 * If no local binary is found we leave the variable unset and let the library
 * download as usual, so CI and other machines keep working. An explicit
 * MONGOMS_SYSTEM_BINARY in the environment always wins.
 */
function findLocalMongod() {
  if (process.env.MONGOMS_SYSTEM_BINARY) return process.env.MONGOMS_SYSTEM_BINARY;

  const candidates = [];
  const winRoot = "C:/Program Files/MongoDB/Server";
  try {
    for (const v of fs.readdirSync(winRoot)) {
      candidates.push(path.join(winRoot, v, "bin", "mongod.exe"));
    }
  } catch {
    // Not Windows, or MongoDB is not installed there. Fall through.
  }
  candidates.push("/usr/bin/mongod", "/usr/local/bin/mongod", "/opt/homebrew/bin/mongod");

  return candidates.find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

const localMongod = findLocalMongod();
if (localMongod) process.env.MONGOMS_SYSTEM_BINARY = localMongod;

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();

  // Belt and braces. A memory server never binds 27017, so if it somehow did,
  // something is very wrong and we stop rather than write to real data.
  if (uri.includes(":27017")) {
    throw new Error(
      `Refusing to run tests: the in-memory server bound port 27017, which is the ` +
        `real development database. URI was ${uri}`
    );
  }

  await mongoose.connect(uri);
});

/**
 * Truncate rather than drop. Dropping a database discards its indexes, and
 * several defects in this codebase are ABOUT indexes — the unique sparse
 * {txHash:1} that makes crypto settlement idempotent, and the unique
 * {userId,derivationIndex} that stops two invoices sharing a payment address.
 * A test that silently lost those would prove the opposite of what it claims.
 */
afterEach(async () => {
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});
