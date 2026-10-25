const js = require("@eslint/js");
const globals = require("globals");

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
  {
    files: ["src/controllers/**/*.js"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='require'][arguments.0.value=/\\/models\\//]",
          message: "Controllers reach the database through src/repositories, which scope every query to the signed-in account (P2-5).",
        },
        {
          selector: "ImportDeclaration[source.value=/\\/models\\//]",
          message: "Controllers reach the database through src/repositories, which scope every query to the signed-in account (P2-5).",
        },
      ],
    },
  },
  {
    files: ["src/__tests__/**/*.js", "**/*.test.js"],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
];
