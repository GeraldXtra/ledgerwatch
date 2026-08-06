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
      // Catches the temporal dead zone, which `no-undef` cannot — the variable
      // is in scope, just declared later. `functions: false` because hoisted
      // function declarations are idiomatic here.
      "no-use-before-define": ["error", { functions: false, variables: true, classes: true }],
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
];
