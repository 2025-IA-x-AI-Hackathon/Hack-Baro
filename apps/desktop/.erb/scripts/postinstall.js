#!/usr/bin/env node
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const cwd = process.cwd();
const isReleaseInstall = cwd.includes(`${path.sep}release${path.sep}app`);

if (isReleaseInstall) {
  console.log(
    "Skipping desktop postinstall inside release/app packaging context",
  );
  process.exit(0);
}

try {
  execSync("ts-node ./.erb/scripts/check-native-dep.js", { stdio: "inherit" });
} catch (error) {
  process.exit(error.status ?? 1);
}

let shouldSkipInstallAppDeps =
  process.env.CI === "true" || process.env.BARO_SKIP_ELECTRON_BUILDER === "1";

const repoRoot = path.resolve(__dirname, "../../../../");
const uiPackageDir = path.join(repoRoot, "packages", "ui");
const uiPackageJson = path.join(uiPackageDir, "package.json");
const uiPnpmLock = path.join(uiPackageDir, "pnpm-lock.yaml");
const uiYarnLock = path.join(uiPackageDir, "yarn.lock");
const uiNpmLock = path.join(uiPackageDir, "package-lock.json");

const hasPackageJson = fs.existsSync(uiPackageJson);
const hasLockFile =
  fs.existsSync(uiPnpmLock) ||
  fs.existsSync(uiYarnLock) ||
  fs.existsSync(uiNpmLock);

if (!shouldSkipInstallAppDeps && (!hasPackageJson || !hasLockFile)) {
  console.warn(
    "Skipping electron-builder install-app-deps because packages/ui is not yet bootstrapped. " +
      'Run "pnpm install --filter @baro/ui" or set BARO_SKIP_ELECTRON_BUILDER=1 if you need to install native deps.',
  );
  shouldSkipInstallAppDeps = true;
}

if (shouldSkipInstallAppDeps) {
  console.log("Skipping electron-builder install-app-deps");
} else {
  execSync("electron-builder install-app-deps", {
    stdio: "inherit",
    env: { ...process.env, BARO_SKIP_ELECTRON_BUILDER: "1" },
  });
}

try {
  execSync("pnpm run build:dll", { stdio: "inherit" });
} catch (error) {
  process.exit(error.status ?? 1);
}
