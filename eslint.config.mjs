import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const config = [
  // Ignore gitignored generated files / vendored dirs — they contain minified
  // third-party JS or build output that must not be linted.
  {
    ignores: [
      ".next/**",
      ".worktrees/**",
      "playwright-report/**",
      "test-results/**",
      "tests/e2e/playwright-report/**",
      "tests/e2e/test-results/**",
    ],
  },
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // Standard convention: underscore-prefixed args are intentionally unused.
      // Next.js route handlers frequently receive req/ctx that aren't needed.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Playwright test fixtures use a `use` callback that is not a React hook.
  // Disable react-hooks rules for the e2e test directory to prevent false positives.
  {
    files: ["tests/e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
];

export default config;
