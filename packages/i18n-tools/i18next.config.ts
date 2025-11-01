import path from "node:path";
import { fileURLToPath } from "node:url";

// The CLI supports TS config; this file centralizes extraction + type generation.
// Reference: https://github.com/i18next/i18next-cli

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const desktopSrcGlob = path.join(
  repoRoot,
  "apps",
  "desktop",
  "src",
  "**",
  "*.{ts,tsx}",
);
const localesDir = path.join(repoRoot, "apps", "desktop", "locales");

export default {
  locales: ["en-US", "ko-KR"],
  // Ensure English is the primary language for syncing/types
  extract: {
    defaultNS: "common",
    input: [desktopSrcGlob],
    output: path.join(localesDir, "{{language}}", "{{namespace}}.json"),
    ignore: ["**/node_modules/**", "**/.erb/**"],
    mergeNamespaces: false,
    functions: ["t", "*.t", "i18next.t"],
    transComponents: ["Trans", "Translation"],
    preservePatterns: ["languageSwitcher.*"],
  },
  // Primary language defaults to the first in `locales`, but make it explicit
  primaryLanguage: "en-US",
  types: {
    input: [path.join(localesDir, "en-US", "*.json")],
    output: path.join(repoRoot, "apps", "desktop", "src", "types", "i18n.d.ts"),
    resourcesFile: path.join(
      repoRoot,
      "apps",
      "desktop",
      "src",
      "types",
      "resources.d.ts",
    ),
    defaultNS: "common",
    enableSelector: false,
  },
};
