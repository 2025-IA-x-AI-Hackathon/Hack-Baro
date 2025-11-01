# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Posely** is a privacy-first desktop application for real-time posture monitoring and correction. It uses on-device AI/ML to analyze webcam input and provide gentle feedback to users about their posture. All processing happens locally - no data ever leaves the user's device.

**Current Status**: This is a Turborepo monorepo currently scaffolded with Next.js placeholder apps. The main Electron desktop application (Epic 0) is planned but not yet implemented.

## Essential Development Commands

### Monorepo Management
```bash
# Install dependencies (run after clone or when package.json changes)
pnpm install

# Run all apps in development mode
pnpm dev

# Run specific app with filter
turbo dev --filter=web        # Run web app only (port 3000)
turbo dev --filter=docs       # Run docs app only (port 3001)

# Build all apps
pnpm build

# Build specific app
turbo build --filter=web
```

### Code Quality
```bash
# Lint all code (must have zero warnings)
pnpm lint

# Type check all TypeScript
pnpm type-check

# Format all code with Prettier
pnpm format
```

### Testing
Tests are not yet configured. When implemented:
- Unit/Integration: Vitest (preferred) or Jest
- E2E: Playwright for Electron app testing
- Run via `turbo test` across all packages

## Architecture Overview

### Monorepo Structure
```
/
├── apps/
│   ├── web/              # Next.js app (currently placeholder, port 3000)
│   ├── docs/             # Next.js app (currently placeholder, port 3001)
│   └── desktop/          # [TO BE CREATED] Main Electron application
├── packages/
│   ├── ui/               # Shared React components
│   ├── eslint-config/    # Shared ESLint configuration
│   └── typescript-config/ # Shared TypeScript configuration
└── docs/                 # Product documentation (PRD, architecture, epics)
```

### Future Electron App Architecture (apps/desktop - Not Yet Implemented)

The main application will use a **multi-process Electron architecture**:

1. **Main Process**: Backend with full Node.js access, manages windows, OS integration, file system, and SQLite database
2. **Renderer Process**: Frontend React UI running in sandboxed environment with IPC for privileged operations
3. **Worker Process**: Dedicated thread for AI/ML model (ONNX Runtime) to avoid blocking main thread

**Key Technical Decisions**:
- **Privacy-First**: 100% client-only, zero cloud communication
- **On-Device AI**: ONNX Runtime for pose detection in Worker thread
- **Local Storage**: SQLite database managed via Drizzle ORM
- **IPC Communication**: Strict message-based communication between processes with security validation

### Technology Stack

| Layer | Technology |
|-------|-----------|
| **Monorepo** | Turborepo + pnpm workspaces |
| **Desktop Framework** | Electron (planned) |
| **Frontend** | React 19 + TypeScript 5.9.2 |
| **UI Framework** | Next.js 15.5.0 (current apps) |
| **Styling** | Tailwind CSS |
| **State Management** | Zustand (for desktop app) |
| **Database** | SQLite + Drizzle ORM (for desktop app) |
| **AI/ML Runtime** | ONNX Runtime (for desktop app) |
| **Testing** | Vitest/Jest + Playwright |
| **Code Quality** | ESLint + Prettier + TypeScript strict mode |

## Working with the Monorepo

### Adding Dependencies

For workspace-specific dependencies:
```bash
# Add to specific app/package
cd apps/web
pnpm add <package>

# Or from root
pnpm add <package> --filter=web
```

For shared dependencies across workspaces:
```bash
# Add to root (affects all workspaces)
pnpm add -w <package>
```

### Using Shared Packages

Internal packages use workspace protocol:
```json
{
  "dependencies": {
    "@heroui/react": "2.8.5",
    "@heroui/theme": "2.4.23",
    "framer-motion": "^12.23.24"
  }
}
```

Import from shared packages:
```typescript
import { Button } from "@heroui/react";
```

### Turborepo Caching

Turborepo caches build outputs for speed. If you need to clear cache:
```bash
turbo build --force  # Ignore cache and rebuild
```

## Key Design Patterns

### Privacy-First Architecture
- **NEVER** add any network requests or cloud services to the desktop app
- All user data must remain on local machine
- Video frames never leave the Worker process
- Database file stored in OS-standard app data directory

### IPC Communication (Future Desktop App)
- Use `ipcRenderer.invoke()` for async request-response from Renderer to Main
- Use `webContents.send()` for push notifications from Main to Renderer
- Use `postMessage()` with `transfer` option for high-throughput Worker communication
- Always validate input from Renderer in Main process (treat as untrusted)
- Define all IPC channels as constants in shared file for type safety

### Database Patterns (Future Desktop App)
- Use Drizzle ORM for type-safe database operations
- Store aggregated summaries in `DAILY_POSTURE_SUMMARY` for dashboard performance
- Keep detailed events in `POSTURE_EVENTS` for analysis but don't query for UI
- All timestamps use Unix seconds (INTEGER type in SQLite)

## Documentation Structure

Comprehensive product documentation lives in `docs/`:
- `docs/project-brief.md` - Executive summary and problem statement
- `docs/prd.md` - Complete product requirements document
- `docs/architecture.md` - Technical architecture specification
- `docs/epics/*.md` - Epic-level feature specifications
- `docs/stories/*.md` - Detailed user stories (when created)

**Always review relevant docs before implementing features to understand requirements and constraints.**

## Critical Constraints

### What NOT to Do
1. **Never compromise privacy**: No cloud services, no analytics that send data externally
2. **Never skip type checking**: This project uses TypeScript strict mode for safety
3. **Never bypass security**: Renderer must stay sandboxed, all privileged ops via Main process
4. **Never block UI thread**: Heavy computation (AI/ML) must run in Worker process
5. **Never assume Python**: AI/ML uses JavaScript-compatible ONNX Runtime (not Python libraries)

### Performance Requirements
- CPU usage must stay below 15% average
- UI must remain responsive during posture analysis (hence Worker thread)
- Database queries for dashboard must use aggregated summary tables, not raw events

## Next Steps for Development

According to the PRD, the implementation order is:

1. **Epic 0** (In Progress): Development foundation - set up Electron app structure in `apps/desktop/`
2. **Epic 1**: Core monitoring & feedback - webcam access, calibration, menu bar icon
3. **Epic 2**: Progress dashboard - posture scores, trends, charts
4. **Epic 3**: Onboarding & settings - first-run experience, user controls
5. **Epic 4** (Parallel): AI/ML engine - MediaPipe integration, posture detection algorithms

Refer to epic files in `docs/epics/` for detailed specifications of each epic.

## Troubleshooting

### pnpm install fails
- Ensure Node.js >= 18 is installed
- Delete `node_modules`, `pnpm-lock.yaml` and retry
- Run `pnpm store prune` to clean pnpm cache

### Turborepo tasks fail
- Check `turbo.json` for task configuration
- Verify all dependencies are installed
- Clear Turborepo cache with `rm -rf .turbo`

### Type errors after pulling changes
- Run `pnpm install` to ensure dependencies are synced
- Run `pnpm type-check` to see all type errors
- Check that `tsconfig.json` extends from `@baro/typescript-config`
