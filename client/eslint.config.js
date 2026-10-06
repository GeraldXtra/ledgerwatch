import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Minimal lint config, added for ONE reason above all others: `no-undef`.
 *
 * A reference to a variable that does not exist in scope compiles perfectly.
 * Vite/esbuild transpiles without scope analysis, so `npm run build` is green
 * and the page crashes the moment that line renders. That is exactly how
 * `currentRate` — declared in `CryptoPaymentPanel` and used inside
 * `AddressCard`, a different component — reached the browser and took the whole
 * crypto payment card into the error boundary.
 *
 * Deliberately narrow. This is not a style pass: style rules on an existing
 * codebase produce hundreds of findings that bury the handful that are real
 * bugs. Only rules that catch code which is actually broken are errors here.
 */
export default [
  {
    /**
     * `public/**` USED TO BE IGNORED, and the one file in the client that most
     * needs `no-undef` lives there. `public/sw.js` is real shipped code: it runs
     * outside the page, handles notification button presses and posts to the
     * API, and it is the only file here that cannot be caught by a React error
     * boundary — an undefined identifier in it fails silently, in a context
     * nobody is looking at. The config already loads service-worker globals for
     * it, which shows the intention was always to cover it.
     *
     * `dist` and `node_modules` stay ignored: neither is source.
     *
     * NOTE for whoever wields the npm script: `"lint": "eslint src"` in
     * package.json still points at src alone, so this only takes effect when
     * eslint is given the other paths (`npx eslint src public scripts`).
     * Widening that script is a one-word change and belongs with this.
     */
    ignores: ["dist/**", "node_modules/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { react, "react-hooks": reactHooks },
    rules: {
      // THE ONE THAT MATTERS. An undefined identifier is always a bug.
      "no-undef": "error",

      /**
       * Without this, plain `no-unused-vars` cannot see that a component is used
       * inside JSX, and reports every imported component as dead — 575 false
       * findings on this codebase. Warnings nobody can trust are worse than no
       * warnings, because the real ones drown in them.
       */
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",

      // Catches a stale closure or a missing dependency silently serving old
      // data — the class of bug that looks like "it just didn't update".
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      /**
       * Warnings, not errors: an unused variable is untidy but harmless, and
       * failing the lint on it would mean nobody runs the lint. Args are
       * ignored entirely — React callbacks routinely take parameters they do
       * not use, and `catch {}` blocks deliberately discard the error.
       */
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
  {
    /**
     * The build-time scripts: CommonJS, run by node, never bundled. They were
     * outside the lint entirely, so `no-undef` — the rule this whole config
     * exists for — had never been applied to the screenshot generator or the
     * icon generator. Same rules, different globals; without the node set every
     * `require`, `process` and `Buffer` in them reads as undefined.
     */
    files: ["scripts/**/*.cjs", "scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      // Node AND browser: the screenshot script hands callbacks to Puppeteer
      // that are serialised and evaluated inside the page, where `document` is
      // real. Both sets are needed or every one of those is a false positive.
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
];
