const { z } = require("zod");

const NUMBER_TEXT = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
const UNSIGNED_INTEGER_TEXT = /^\d+$/;

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "That is not a valid id.");

const text = (max) => z.string().max(max);

const numberish = z
  .union([z.number(), z.string().trim().max(40).regex(NUMBER_TEXT, "That is not a number.")])
  .transform(Number)
  .refine((n) => Number.isFinite(n), "That is not a finite number.");

const integerish = numberish.refine((n) => Number.isInteger(n), "That must be a whole number.");

const emptyOr = (schema) => z.union([z.literal(""), schema]);

const dateish = z
  .union([z.string().trim().max(40), z.number()])
  .refine((v) => !Number.isNaN(new Date(v).getTime()), "That is not a valid date.");

const booleanish = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => v === true || v === "true" || v === "1");

const unitsString = z
  .union([z.string().trim().max(80).regex(UNSIGNED_INTEGER_TEXT, "That must be a whole number of base units."), z.number().int().nonnegative()])
  .transform(String);

const decimalString = z
  .union([z.string().trim().max(80).regex(NUMBER_TEXT, "That is not a number."), z.number()])
  .transform(String);

const evmAddress = z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/, "That is not a valid address.");
const txHash = z.string().trim().regex(/^0x[0-9a-fA-F]{64}$/, "That is not a valid transaction hash.");
const chainId = integerish.refine((n) => n > 0, "That is not a valid network.");
const network = z.enum(["mainnet", "testnet"]);

module.exports = {
  z,
  objectId,
  text,
  numberish,
  integerish,
  emptyOr,
  dateish,
  booleanish,
  unitsString,
  decimalString,
  evmAddress,
  txHash,
  chainId,
  network,
};
