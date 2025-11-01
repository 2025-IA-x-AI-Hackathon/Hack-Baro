# Posely Desktop Integration Notes

This document tracks the changes made while embedding Electron React Boilerplate into the Posely Turborepo.

## Workspace Integration

- Package renamed to `@baro/desktop` and registered as a Turborepo workspace package.
- Scripts updated to use pnpm and wired into the shared Turbo pipelines (`dev`, `build`, `lint`, `type-check`).
- Added workspace dependencies on `@heroui/react`, `@heroui/theme`, `framer-motion`, `@baro/eslint-config`, and `@baro/typescript-config`.
- Shared TypeScript configuration is inherited from `@baro/typescript-config/base.json` with monorepo-aware path mappings for `@baro/*` imports.

## Build Configuration

- Webpack base config now transpiles workspace packages and resolves modules from `packages/`.
- Main-process webpack entries include a worker bundle so the worker thread is built alongside main and preload outputs.
- Release runtime package (`release/app/package.json`) updated for pnpm-based installs.

## IPC and Worker Architecture

- New shared channel definitions live in `src/shared/ipcChannels.ts`.
- The main process launches a dedicated worker thread (`src/worker/index.ts`) and forwards worker messages to the renderer.
- Renderer exposes actions for pinging the main process and worker, with responses rendered in real time.
- IPC bridge is hardened in `preload.ts` to validate channel usage before forwarding to Electron.

## Renderer Updates

- Renderer UI imports components from `@heroui/react` and surfaces integration diagnostics (main response, worker status, worker response).
- Initial worker status requests happen automatically once listeners are registered, ensuring state remains in sync across reloads.

## Developer Commands

```bash
pnpm dev       # Runs the desktop app in development mode via Turborepo
pnpm build     # Builds renderer + main bundles
pnpm package   # Produces distributable artifacts with electron-builder
pnpm lint      # Executes lint rules (shared config via @baro/eslint-config)
pnpm type-check # Validates TypeScript types across main/renderer/worker
```

## Environment Separation & CI/CD

- **Local development installs** – use `pnpm run desktop:install:dev` (sets `BARO_SKIP_ELECTRON_BUILDER=1`) so pnpm skips Electron Builder’s native dependency rebuild during install. Follow with `pnpm run desktop:dev` to start the desktop workspace via Turbo.
- **Packaging** – run `pnpm run desktop:package` (or `pnpm --filter @baro/desktop package`) which invokes Electron Builder to generate platform-specific artifacts in `release/build/`. Ensure `BARO_SKIP_ELECTRON_BUILDER` is unset before packaging if you previously exported it. macOS packaging requires an Apple Development/Distribution certificate in your login keychain; if multiple identities share the same name, either remove duplicates in Keychain Access or run with `CSC_IDENTITY_AUTO_DISCOVERY=false` and `CSC_NAME="Apple Development: Your Name (TEAMID)"`. To generate unsigned builds for quick validation, set `CSC_IDENTITY_AUTO_DISCOVERY=false` with an empty `CSC_NAME`.
- **Continuous Integration** – `.github/workflows/ci.yml` installs with `--frozen-lockfile` and runs `pnpm turbo run type-check lint build` under `BARO_SKIP_ELECTRON_BUILDER=1` to keep pipeline deterministic. Release tags trigger `.github/workflows/release.yml`, which installs (skipping native rebuilds), runs the desktop build, executes the packaging script per operating system, and uploads the generated artifacts.

## Upgrade Notes

- When pulling upstream Electron React Boilerplate changes, verify updates in `.erb/` configs and re-run through Turborepo scripts.
- Confirm any new upstream dependencies remain compatible with pnpm workspaces and the shared lint/config packages.
- Keep worker message contracts documented in `src/shared/ipcChannels.ts` to maintain compatibility across processes.

