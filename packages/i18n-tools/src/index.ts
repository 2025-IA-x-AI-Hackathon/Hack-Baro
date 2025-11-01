import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Helpers for resolving i18n-related paths from within the Turborepo workspace.
 * This allows other packages/apps to import `@baro/i18n-tools` and avoid
 * re-computing the same path logic that the CLI configuration already uses.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(packageRoot, "..", "..");

export const LOCALES_ROOT = path.join(
  workspaceRoot,
  "apps",
  "desktop",
  "locales",
);
export const DESKTOP_TYPES_DIR = path.join(
  workspaceRoot,
  "apps",
  "desktop",
  "src",
  "types",
);

export const I18NEXT_CONFIG_PATH = path.join(packageRoot, "i18next.config.ts");
export const TYPES_DEFINITION_PATH = path.join(DESKTOP_TYPES_DIR, "i18n.d.ts");
export const TYPES_RESOURCES_PATH = path.join(
  DESKTOP_TYPES_DIR,
  "resources.d.ts",
);

export const DEFAULT_LOCALES = ["en-US", "ko-KR"] as const;

export const LOCALE_JSON_PATTERN = "**/*.json" as const;

export function resolveWorkspacePath(...segments: string[]): string {
  return path.join(workspaceRoot, ...segments);
}

export function resolveLocalesGlob(
  pattern: string = LOCALE_JSON_PATTERN,
): string {
  return path.join(LOCALES_ROOT, pattern);
}

export function resolveTypesOutputs() {
  return {
    definition: TYPES_DEFINITION_PATH,
    resources: TYPES_RESOURCES_PATH,
  } as const;
}
