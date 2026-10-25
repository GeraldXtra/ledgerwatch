const { z } = require("zod");

const PARTS = ["params", "query", "body"];
const EMPTY = z.object({});

function fieldName(part, path) {
  if (!path.length) return part === "body" ? "The request body" : `The ${part}`;
  return path.map(String).join(".");
}

function describeIssue(part, issue) {
  const field = fieldName(part, issue.path || []);
  const received = String(issue.message || "");
  if (received && !/^(Invalid|Too (big|small)|Unrecognized)/i.test(received)) return received;
  switch (issue.code) {
    case "invalid_type":
      return /received undefined/.test(received) ? `${field} is required.` : `${field} has the wrong type.`;
    case "too_big":
      if (issue.origin === "string") return `${field} must be at most ${issue.maximum} characters.`;
      if (issue.origin === "array") return `${field} can hold at most ${issue.maximum} items.`;
      return `${field} must be at most ${issue.maximum}.`;
    case "too_small":
      if (issue.origin === "string") {
        return issue.minimum <= 1 ? `${field} cannot be empty.` : `${field} must be at least ${issue.minimum} characters.`;
      }
      if (issue.origin === "array") return `${field} needs at least ${issue.minimum} item(s).`;
      return `${field} must be at least ${issue.minimum}.`;
    case "invalid_value":
      return `${field} must be one of: ${(issue.values || []).map(String).join(", ")}.`;
    default:
      return `${field} is not valid.`;
  }
}

function validate(shape) {
  const schemas = {};
  for (const part of PARTS) schemas[part] = shape[part] || EMPTY;

  const middleware = (req, res, next) => {
    for (const part of PARTS) {
      const result = schemas[part].safeParse(req[part] == null ? {} : req[part]);
      if (!result.success) {
        const issue = result.error.issues[0];
        return res.status(400).json({
          error: describeIssue(part, issue),
          field: fieldName(part, issue.path || []),
        });
      }
      if (part === "query") {
        Object.defineProperty(req, "query", { value: result.data, writable: true, configurable: true, enumerable: true });
      } else {
        req[part] = result.data;
      }
    }
    return next();
  };
  middleware.isValidator = true;
  return middleware;
}

module.exports = { validate };
