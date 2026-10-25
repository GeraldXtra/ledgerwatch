const mongoose = require("mongoose");
const User = require("../models/User");
const Debt = require("../models/Debt");
const Payment = require("../models/Payment");
const PaymentAddress = require("../models/PaymentAddress");
const Reminder = require("../models/Reminder");
const Watch = require("../models/Watch");
const Alert = require("../models/Alert");
const SimTrade = require("../models/SimTrade");
const Portfolio = require("../models/Portfolio");
const WalletTx = require("../models/WalletTx");
const PushSubscription = require("../models/PushSubscription");
const ProfitRecord = require("../models/ProfitRecord");
const RampOrder = require("../models/RampOrder");
const EmailOptOut = require("../models/EmailOptOut");

const TENANT_MODELS = {
  debts: Debt,
  payments: Payment,
  paymentAddresses: PaymentAddress,
  reminders: Reminder,
  watches: Watch,
  alerts: Alert,
  simTrades: SimTrade,
  portfolios: Portfolio,
  walletTxs: WalletTx,
  pushSubscriptions: PushSubscription,
  profits: ProfitRecord,
  rampOrders: RampOrder,
  emailOptOuts: EmailOptOut,
};

const OWNER_FIELDS = new Set(["userId", "_id"]);

function tenancyError(message) {
  const err = new Error(message);
  err.tenancy = true;
  return err;
}

function ownerId(userId) {
  if (userId instanceof mongoose.Types.ObjectId) return userId;
  const raw = userId && typeof userId === "object" && userId._id ? userId._id : userId;
  if (raw instanceof mongoose.Types.ObjectId) return raw;
  if (typeof raw === "string" && mongoose.Types.ObjectId.isValid(raw) && /^[0-9a-fA-F]{24}$/.test(raw)) {
    return new mongoose.Types.ObjectId(raw);
  }
  throw tenancyError("A repository needs the id of the signed-in account.");
}

function plainObject(value, what) {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw tenancyError(`${what} must be an object.`);
  }
  return value;
}

function touchesOwner(update, fields) {
  if (Array.isArray(update)) return true;
  for (const [key, value] of Object.entries(update)) {
    if (key.startsWith("$")) {
      if (value && typeof value === "object" && Object.keys(value).some((k) => fields.has(k.split(".")[0]))) return true;
    } else if (fields.has(key.split(".")[0])) {
      return true;
    }
  }
  return false;
}

function idFilter(id) {
  const valid = id instanceof mongoose.Types.ObjectId || /^[0-9a-fA-F]{24}$/.test(String(id));
  return valid ? { _id: id } : { _id: { $in: [] } };
}

function scopedModel(Model, userId) {
  const owner = ownerId(userId);
  const scope = (filter) => ({ ...plainObject(filter, "A repository filter"), userId: owner });
  const guard = (update) => {
    const u = plainObject(update, "A repository update");
    if (touchesOwner(u, OWNER_FIELDS)) throw tenancyError("A repository update cannot change which account owns a record.");
    return u;
  };
  const stamp = (doc) => ({ ...plainObject(doc, "A new record"), userId: owner });

  return {
    find: (filter, projection, options) => Model.find(scope(filter), projection, options),
    findOne: (filter, projection, options) => Model.findOne(scope(filter), projection, options),
    findById: (id, projection, options) => Model.findOne(scope(idFilter(id)), projection, options),
    exists: (filter) => Model.exists(scope(filter)),
    countDocuments: (filter) => Model.countDocuments(scope(filter)),
    distinct: (field, filter) => Model.distinct(field, scope(filter)),
    create: (doc) => Model.create(stamp(doc)),
    insertMany: (docs) => Model.insertMany((docs || []).map(stamp)),
    updateOne: (filter, update, options) => Model.updateOne(scope(filter), guard(update), options),
    updateMany: (filter, update, options) => Model.updateMany(scope(filter), guard(update), options),
    findOneAndUpdate: (filter, update, options) => Model.findOneAndUpdate(scope(filter), guard(update), options),
    deleteOne: (filter) => Model.deleteOne(scope(filter)),
    deleteMany: (filter) => Model.deleteMany(scope(filter)),
    aggregate: (pipeline) => Model.aggregate([{ $match: { userId: owner } }, ...(pipeline || [])]),
  };
}

const SELF_LOCKED = new Set(["_id", "email", "passwordHash", "tokenVersion", "googleId", "twoFactor", "emailChange", "authProvider"]);

function selfRepository(userId) {
  const owner = ownerId(userId);
  const guard = (update) => {
    const u = plainObject(update, "An account update");
    if (touchesOwner(u, SELF_LOCKED)) {
      throw tenancyError("Sign-in details change only through their own account flows.");
    }
    return u;
  };
  return {
    id: owner,
    get: (projection, options) => User.findById(owner, projection, options),
    update: (update, options) => User.findOneAndUpdate({ _id: owner }, guard(update), { new: true, ...options }),
    updateOne: (update, options) => User.updateOne({ _id: owner }, guard(update), options),
    updateWhere: (filter, update, options) =>
      User.updateOne({ ...plainObject(filter, "An account filter"), _id: owner }, guard(update), options),
    remove: () => User.deleteOne({ _id: owner }),
  };
}

function scopedRepo(userId) {
  const repo = { self: selfRepository(userId) };
  for (const [name, Model] of Object.entries(TENANT_MODELS)) repo[name] = scopedModel(Model, userId);
  return repo;
}

module.exports = { scopedRepo, scopedModel, ownerId, TENANT_MODELS };
