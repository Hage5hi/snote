import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Block hardcoded user-facing strings in JSX attrs that should go through t().
// Selectors error on string literals (both bare and {"..."} forms) for:
//   placeholder, aria-label, title, and <meta content="...">.
// Empty strings are allowed (e.g. placeholder="").
//
// Intentional exceptions MUST:
//   1. Use `eslint-disable-next-line no-restricted-syntax -- <reason>`
//   2. Have a matching entry in .lintrc-i18n-allowlist.json
//   3. Pass `bun run i18n:allowlist` (CI-enforced)
// See docs/i18n-hardcoded-allowlist.md for the full contract.
const HARDCODED_STRING_RULES = [
  {
    selector:
      "JSXAttribute[name.name='placeholder'] > Literal[value!='']",
    message:
      "Hardcoded placeholder string. Wrap with t('…') so it gets translated.",
  },
  {
    selector:
      "JSXAttribute[name.name='placeholder'] > JSXExpressionContainer > Literal[value!='']",
    message:
      "Hardcoded placeholder string. Wrap with t('…') so it gets translated.",
  },
  {
    selector:
      "JSXAttribute[name.name='aria-label'] > Literal[value!='']",
    message:
      "Hardcoded aria-label. Wrap with t('…') so it gets translated.",
  },
  {
    selector:
      "JSXAttribute[name.name='aria-label'] > JSXExpressionContainer > Literal[value!='']",
    message:
      "Hardcoded aria-label. Wrap with t('…') so it gets translated.",
  },
  {
    selector:
      "JSXAttribute[name.name='title'] > Literal[value!='']",
    message:
      "Hardcoded title attribute. Wrap with t('…') so it gets translated.",
  },
  {
    selector:
      "JSXAttribute[name.name='title'] > JSXExpressionContainer > Literal[value!='']",
    message:
      "Hardcoded title attribute. Wrap with t('…') so it gets translated.",
  },
  {
    selector:
      "JSXOpeningElement[name.name='meta'] JSXAttribute[name.name='content'] > Literal[value!='']",
    message:
      "Hardcoded <meta> content. Wrap with t('…') or disable inline for intentional brand SEO.",
  },
];

export default tseslint.config(
  {
    ignores: [
      "artifacts",
      "coverage",
      "dist",
      "e2e",
      "playwright-report",
      "reports",
      "scripts",
      "test-results",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      "no-restricted-syntax": ["error", ...HARDCODED_STRING_RULES],
    },
  },
  {
    // shadcn primitives keep English a11y labels; they are not user-facing copy.
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // Test files freely use literal strings as fixtures.
    files: ["**/__tests__/**", "**/*.test.{ts,tsx}"],
    rules: { "no-restricted-syntax": "off" },
  },
);
