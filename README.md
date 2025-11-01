# Posely

> **Privacy-first posture guidance for healthier desk work**

Posely is a cross-platform desktop application that monitors posture entirely on-device. Our hybrid stack pairs **Electron React Boilerplate** for the desktop runtime with a **Turborepo + pnpm** monorepo so every surface (desktop, docs, web) can share tooling, configuration, and automation.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Built with Electron](https://img.shields.io/badge/Electron-Latest-47848F.svg)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg)](https://www.typescriptlang.org/)

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **pnpm** ≥ 8 (`npm install -g pnpm`)
- Git

### Setup Steps

1. Clone the repository and install dependencies:
   ```bash
   git clone https://github.com/team-baro/baro.git
   cd baro
   pnpm install
   ```
   > Tip: use `pnpm run desktop:install:dev` to install with `BARO_SKIP_ELECTRON_BUILDER=1`, skipping native Electron rebuilds during local development.
2. Duplicate `.env.example` to `.env` (at the repo root and optionally inside `apps/desktop/`) and fill in monitoring credentials:
   - `SENTRY_DSN`
   - `BETTER_STACK_TOKEN`
   - Optional dev overrides: `ENABLE_SENTRY_IN_DEV`, `ENABLE_BETTER_STACK_IN_DEV`
3. Start the desktop app:
   ```bash
   pnpm dev
   # or focus on the Electron workspace only
   pnpm --filter @baro/desktop dev
   ```
4. Run quality checks before committing:
   ```bash
   pnpm lint
   pnpm type-check
   pnpm --filter @baro/desktop test
   ```

For packaging builds, clear `BARO_SKIP_ELECTRON_BUILDER` and run `pnpm run desktop:package`. macOS builds require an Apple Developer/Distribution certificate; unsigned builds are possible by setting `CSC_IDENTITY_AUTO_DISCOVERY=false`.

---

## 📁 Monorepo Layout

```
/
├── apps/
│   ├── desktop/                 # Electron workspace (main, renderer, worker, shared)
│   ├── docs/                    # Next.js docs scaffold (future external docs)
│   └── web/                     # Marketing/landing scaffold
├── docs/                        # Internal product & architecture documentation
│   ├── architecture/
│   └── stories/
├── packages/
│   ├── eslint-config/           # Shared ESLint presets
│   ├── i18n-tools/              # Localization CLI & typed resource generation
│   ├── typescript-config/       # Strict tsconfig presets shared across workspaces
│   └── ui/                      # Shared UI component library scaffold
├── .husky/                      # Git hooks (attached during `pnpm install`)
├── pnpm-workspace.yaml          # Workspace membership & native build allowlist
├── turbo.json                   # Turborepo task graph + global env configuration
├── tsconfig.json                # Root TS project references
└── README.md
```

### Directory Highlights

- `apps/desktop/src/main` – Main process, IPC handlers, OS integrations, worker orchestration.
- `apps/desktop/src/renderer` – React 19 renderer with Zustand stores and internationalization.
- `apps/desktop/src/worker` – Background thread reserved for posture analysis workloads.
- `apps/desktop/src/shared` – Shared utilities, IPC channel definitions, monitoring config.
- `apps/desktop/e2e` – Playwright Electron harness and smoke tests.
- `apps/desktop/INTEGRATION.md` – Detailed log of ERB modifications applied during Turborepo integration.
- `packages/i18n-tools` – Generates typed locale resources and scanning helpers.
- `docs/architecture/4-repository-code-structure.md` – Authoritative repository guide and troubleshooting reference.

---

## 🛠️ Development Workflows

| Command | Description |
| ------- | ----------- |
| `pnpm dev` | Runs Turbo `dev` tasks; launches the Electron app with hot reload. |
| `pnpm --filter @baro/desktop dev` | Starts only the desktop workspace (useful when other apps remain placeholders). |
| `pnpm build` | Executes Turborepo build pipeline, including i18n type generation. |
| `pnpm lint` | Lints all workspaces using shared rules from `@baro/eslint-config`. |
| `pnpm type-check` | Type-checks every workspace via shared tsconfig presets. |
| `pnpm --filter @baro/desktop test` | Runs Vitest unit/integration suites for the desktop app. |
| `pnpm --filter @baro/desktop test:e2e` | Launches Playwright’s Electron harness for end-to-end smoke tests. |
| `pnpm run desktop:package` | Builds production bundles and packages the Electron app. |

Turborepo caches `build`, `lint`, `type-check`, and `test` results. Use `turbo run <task> --force` when a cold rebuild or retest is required. Husky installs hooks automatically so linting, testing, and i18n type generation run before commits/pushes; bypass only with `--no-verify` in emergencies.

---

## 🧪 Testing

- **Unit & Integration**: `pnpm --filter @baro/desktop test` (Vitest). Use `test:watch` and `test:coverage` variants for rapid feedback and HTML reports (`apps/desktop/coverage/`).
- **End-to-End**: `pnpm --filter @baro/desktop test:e2e` launches Electron via Playwright. Run `pnpm --filter @baro/desktop exec playwright install --with-deps` once to download browsers.
- **CI**: `.github/workflows/ci.yml` executes `pnpm turbo run type-check lint build`. Release workflows add packaging steps per operating system.

For detailed guidance, see [`docs/architecture/testing-strategy.md`](docs/architecture/testing-strategy.md).

---

## 🔐 Monitoring & Telemetry

Posely integrates **Sentry** for crash/error reporting and **Better Stack Logtail** for centralized structured logging across all Electron processes.

- Shared initialization lives in `apps/desktop/src/shared/config/monitoring.ts`, exposing privacy-aware defaults and toggles.
- Each process (`src/main/sentry.ts`, `src/renderer/sentry.ts`, `src/worker/sentry.ts`) registers global handlers and tags events with the originating process.
- Populate credentials in `.env` and enable the optional `ENABLE_*_IN_DEV` flags when validating telemetry locally.

---

## 🌐 Internationalization

Localized strings reside in `apps/desktop/locales/<locale>`. Generate strongly typed translation helpers with:

```bash
pnpm --filter @baro/desktop run i18n:generate-types
```

The script runs automatically during `pnpm build` and is enforced by the pre-commit hook.

---

## 📚 Documentation

- [`docs/architecture/4-repository-code-structure.md`](docs/architecture/4-repository-code-structure.md) – Comprehensive repository guide, workflows, and troubleshooting.
- [`docs/architecture/2-high-level-architecture-v2.md`](docs/architecture/2-high-level-architecture-v2.md) – Electron process overview and hybrid architecture rationale.
- [`docs/architecture/testing-strategy.md`](docs/architecture/testing-strategy.md) – Test tooling, execution, and CI integration.
- [`apps/desktop/INTEGRATION.md`](apps/desktop/INTEGRATION.md) – ERB integration notes and upgrade considerations.

Contribute improvements by updating the relevant document and referencing the story that introduced the change.