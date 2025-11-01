import { FlatCompat } from "@eslint/eslintrc";
import eslintPluginTypescript from "@typescript-eslint/eslint-plugin";
import eslintPluginImport from "eslint-plugin-import";
import eslintPluginJsxA11y from "eslint-plugin-jsx-a11y";
import eslintPluginPromise from "eslint-plugin-promise";
import eslintPluginReact from "eslint-plugin-react";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import url from "node:url";
import { config as baseConfig } from "@baro/eslint-config/base";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const STRIP_PLUGINS = new Set(["jest"]);

const normalizePlugins = (() => {
  let hasTsPlugin = true;

  return (config) => {
    if (!config) {
      return config;
    }

    let mutated = false;
    const nextPlugins = config.plugins ? { ...config.plugins } : undefined;

    if (nextPlugins?.["@typescript-eslint"]) {
      if (hasTsPlugin) {
        delete nextPlugins["@typescript-eslint"];
        mutated = true;
      } else {
        hasTsPlugin = true;
      }
    }

    if (nextPlugins) {
      for (const pluginName of STRIP_PLUGINS) {
        if (nextPlugins[pluginName]) {
          delete nextPlugins[pluginName];
          mutated = true;
        }
      }
    }

    let nextRules = config.rules;
    if (nextRules) {
      const rewrittenRules = Object.entries(nextRules).reduce(
        (acc, [ruleName, value]) => {
          if (ruleName.startsWith("jest/")) {
            mutated = true;
            return acc;
          }
          acc[ruleName] = value;
          return acc;
        },
        {},
      );

      if (
        Object.keys(rewrittenRules).length !== Object.keys(nextRules).length
      ) {
        nextRules = rewrittenRules;
      } else {
        nextRules = undefined;
      }
    }

    if (!mutated) {
      return config;
    }

    const result = { ...config };

    if (nextPlugins !== undefined) {
      result.plugins = nextPlugins;
    }

    if (nextRules !== undefined) {
      result.rules = nextRules;
    }

    return result;
  };
})();

const baseConfigNormalized = baseConfig.map(normalizePlugins);
const compatConfigNormalized = compat.extends("erb").map(normalizePlugins);

export default [
  {
    ignores: [
      "**/logs/**",
      "**/*.log",
      "**/pids/**",
      "**/*.pid",
      "**/*.seed",
      "**/coverage/**",
      "**/.eslintcache",
      "**/node_modules/**",
      "**/.DS_Store",
      "**/dist/**",
      "**/release/**",
      "**/.erb/dll/**",
      "**/.erb/configs/**",
      "**/.idea/**",
      "**/npm-debug.log.*",
      "**/*.css.d.ts",
      "**/*.sass.d.ts",
      "**/*.scss.d.ts",
      "**/vitest.config.mts",
    ],
  },
  {
    plugins: {
      "@typescript-eslint": eslintPluginTypescript,
    },
  },
  ...baseConfigNormalized,
  ...compatConfigNormalized,
  {
    files: ["e2e/**/*.js"],
    rules: {
      "import/no-extraneous-dependencies": "off",
      "no-underscore-dangle": "off",
      "promise/catch-or-return": "off",
    },
  },
  {
    files: [".erb/scripts/**/*.{js,ts}"],
    languageOptions: {
      sourceType: "commonjs",
    },
    rules: {
      "no-console": "off",
      "import/extensions": "off",
      "import/no-unresolved": "off",
      "import/no-extraneous-dependencies": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      import: eslintPluginImport,
      "jsx-a11y": eslintPluginJsxA11y,
      promise: eslintPluginPromise,
      react: eslintPluginReact,
      "react-hooks": eslintPluginReactHooks,
    },
    settings: {
      "import/resolver": {
        node: {
          extensions: [".js", ".jsx", ".ts", ".tsx"],
          moduleDirectory: ["node_modules", "src/", "../../packages"],
        },
        webpack: {
          config: path.resolve(
            __dirname,
            ".erb/configs/webpack.config.eslint.ts",
          ),
        },
        typescript: {},
      },
      "import/parsers": {
        "@typescript-eslint/parser": [".ts", ".tsx"],
      },
      react: {
        version: "detect",
      },
    },
    rules: {
      "import/no-extraneous-dependencies": "off",
      "react/react-in-jsx-scope": "off",
      "react/jsx-filename-extension": "off",
      "import/extensions": "off",
      "import/no-unresolved": "off",
      "import/no-import-module-exports": "off",
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": "error",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "error",
    },
  },
  {
    files: ["src/main/__tests__/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
        },
      ],
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["src/main/preload.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
  {
    files: ["vitest.config.mts"],
    languageOptions: {
      parserOptions: {
        project: null,
      },
    },
    rules: {
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-array-delete": "off",
      "@typescript-eslint/no-base-to-string": "off",
    },
  },
  {
    files: ["eslint.config.mjs"],
    rules: {
      "import/no-extraneous-dependencies": "off",
      "no-underscore-dangle": "off",
    },
  },
];
