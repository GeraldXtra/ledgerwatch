const js = require("@eslint/js");
const globals = require("globals");

/**
 * Server lint, for the same reason as the client's: `no-undef`.
 *
 * `require()` succeeding proves a module PARSES, not that every path inside it
 * resolves. A dangling reference left behind by a refactor — a function moved to
 * another service, a variable removed from scope — loads fine and throws only
 * when that branch runs, which on a settlement path might be in front of an
 * audience. This catches it statically instead.
 */
module.exports = [
  { ignores: ["node_modules/**", "public/**", "uploads/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  /**
   * Test files run under vitest with `globals: true`, so describe/it/expect and
   * the lifecycle hooks are injected rather than imported. Without this block
   * `no-undef` flags every one of them, which it did: 24 errors that nobody saw
   * because the harness landed in one session and only the client was linted
   * afterwards. A lint gate that is failing for a reason everybody has agreed to
   * ignore is not a gate.
   */
  {
    files: ["src/__tests__/**/*.js", "**/*.test.js"],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
];
