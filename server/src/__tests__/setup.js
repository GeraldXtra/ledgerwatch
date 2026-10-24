const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

function findLocalMongod() {
  if (process.env.MONGOMS_SYSTEM_BINARY) return process.env.MONGOMS_SYSTEM_BINARY;

  const candidates = [];
  const winRoot = "C:/Program Files/MongoDB/Server";
  try {
    for (const v of fs.readdirSync(winRoot)) {
      candidates.push(path.join(winRoot, v, "bin", "mongod.exe"));
    }
  } catch {
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

  if (uri.includes(":27017")) {
    throw new Error(
      `Refusing to run tests: the in-memory server bound port 27017, which is the ` +
        `real development database. URI was ${uri}`
    );
  }

  await mongoose.connect(uri);
});

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
