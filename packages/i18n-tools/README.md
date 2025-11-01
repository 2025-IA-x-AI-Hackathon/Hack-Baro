@baro/i18n-tools
=================

Workspace-local CLI config and helpers for i18next key extraction and TypeScript type generation.

Scripts
- `pnpm run scan` – Extract keys from app source and sync locale JSON files
- `pnpm run types` – Generate `apps/desktop/src/types/i18n.d.ts` and `resources.d.ts`
- `pnpm run watch` – Watch for changes and re-extract keys during development

Notes
- Config lives in `i18next.config.ts` and targets the desktop app by default.
- Primary language is `en-US`; types are generated from `en-US` resources.
- Adjust `locales` array and `input`/`output` paths if you extend to more apps.

