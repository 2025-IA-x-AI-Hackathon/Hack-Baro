import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import onlyWarn from "eslint-plugin-only-warn";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";

const typeCheckedConfigs = tseslint.configs.recommendedTypeChecked.map(
  (configEntry) => ({
    ...configEntry,
    files: configEntry.files ?? ["**/*.ts", "**/*.tsx"],
  }),
);

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  ...typeCheckedConfigs,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: [
          "./tsconfig.json",
          "apps/*/tsconfig.json",
          "packages/*/tsconfig.json",
        ],
        tsconfigRootDir: process.cwd(),
      },
    },
  },
  {
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  {
    plugins: {
      onlyWarn,
    },
  },
  {
    ignores: ["dist/**"],
  },
];
