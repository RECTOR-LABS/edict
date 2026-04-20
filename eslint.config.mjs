import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const config = [
  // Ignore Playwright report artifacts — gitignored generated files that must
  // not be linted (they contain minified third-party JS that triggers many rules).
  { ignores: ["playwright-report/**", "test-results/**"] },
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
