# Posely

> 개인정보를 우선하는 자세 교정 데스크톱 앱

Posely는 온디바이스(on-device) 환경에서 전적으로 사용자 개인정보를 보호하며 자세를 모니터링하는 크로스플랫폼 데스크톱 애플리케이션입니다.
`Electron React Boilerplate`를 기반으로 한 데스크톱 런타임과 `Turborepo + pnpm` 모노레포 구조를 결합해, 데스크톱과 웹 환경 모두에서 도구, 설정, 자동화를 공유할 수 있습니다.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Built with Electron](https://img.shields.io/badge/Electron-Latest-47848F.svg)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg)](https://www.typescriptlang.org/)

***

## 🚀 빠른 시작 (Quick Start)

### 필수 조건
- Node.js ≥ 22
- pnpm ≥ 10 (`npm install -g pnpm`)
- Git

### 설치 및 실행 단계
1. 저장소를 클론하고 의존성을 설치합니다:

**아래 명령어를 실행해주세요! `better-sqlite3` 를 Electron 용으로 재설치하지 않으면 실행이 되지 않습니다.**

```
git clone https://github.com/2025-IA-x-AI-Hackathon/Hack-Baro.git
cd Hack-Baro
pnpm install
# better-sqlite3 재설치
pnpm --filter @baro/desktop exec electron-rebuild --force --only better-sqlite3
```

2. `.env.example`을 복사해 `.env` 파일을 생성하고(루트 및 필요 시 `apps/desktop/` 내부에도 생성) 다음 값을 채웁니다:

- `SENTRY_DSN`
- `BETTER_STACK_TOKEN`
- (선택) 개발용 토글: `ENABLE_SENTRY_IN_DEV`, `ENABLE_BETTER_STACK_IN_DEV`

3. 데스크톱 앱 실행:
```
pnpm dev
# 또는 Electron 워크스페이스만 실행
pnpm --filter @baro/desktop dev
```

4. 커밋 전 품질 검사:

```
pnpm lint
pnpm type-check
pnpm --filter @baro/desktop test
```

빌드 및 패키징 시에는 `BARO_SKIP_ELECTRON_BUILDER`를 제거하고 다음을 실행하세요: `pnpm run desktop:package`. macOS 빌드에는 Apple Developer/Distribution 인증서가 필요하며,
`CSC_IDENTITY_AUTO_DISCOVERY=false` 설정으로 서명 없이 빌드할 수도 있습니다.

***

## 📁 모노레포 구조 (Monorepo Layout)
```
/
├── apps/
│   ├── desktop/                 # Electron 워크스페이스 (main, renderer, worker, shared)
│   └── web/                     # 마케팅/랜딩용 스캐폴드
├── packages/
│   ├── eslint-config/           # 공통 ESLint 설정
│   ├── i18n-tools/              # 다국어 리소스 CLI 및 타입 생성기
│   ├── typescript-config/       # 공통 TypeScript 구성
│   └── ui/                      # 공용 UI 컴포넌트 라이브러리
├── .husky/                      # Git 훅 (pnpm install 시 자동 설치)
├── pnpm-workspace.yaml          # 워크스페이스 구성 및 빌드 허용 목록
├── turbo.json                   # Turborepo 태스크 그래프 및 전역 환경 설정
├── tsconfig.json                # 루트 TypeScript 프로젝트 참조
└── README.md
```

### 주요 디렉터리 설명
- `apps/desktop/src/main` – 메인 프로세스, IPC 핸들러, OS 통합, 워커 관리
- `apps/desktop/src/renderer` – React 19 렌더러, Zustand 상태 관리, 다국어 처리
- `apps/desktop/src/worker` – 자세 분석 등의 백그라운드 연산 처리
- `apps/desktop/src/shared` – 공용 유틸리티, IPC 채널 정의, 모니터링 설정
- `apps/desktop/e2e` – Playwright 기반 Electron E2E 테스트
- `apps/desktop/INTEGRATION.md` – Turborepo 통합 관련 변경 로그

- `packages/i18n-tools` – 다국어 타입 생성기 및 헬퍼 스크립트

***

## 🛠️ 개발 워크플로우 (Development Workflows)

| 명령어 | 설명 |
| ------- | ----- |
| `pnpm dev` | Turbo `dev` 태스크 실행 (핫리로드 포함) |
| `pnpm --filter @baro/desktop dev` | 데스크톱 워크스페이스만 실행 |
| `pnpm build` | 빌드 파이프라인 실행 (i18n 타입 포함) |
| `pnpm lint` | 린트 검사 (`@baro/eslint-config`) |
| `pnpm type-check` | 타입 검사 실행 |
| `pnpm --filter @baro/desktop test` | Vitest 단위/통합 테스트 |
| `pnpm --filter @baro/desktop test:e2e` | Playwright 기반 E2E 테스트 |
| `pnpm run desktop:package` | 프로덕션 빌드 및 패키징 |

Turborepo는 `build`, `lint`, `type-check`, `test` 결과를 캐시합니다. 강제 재빌드/재테스트가 필요할 경우 `turbo run <task> --force`를 사용하세요.

***

## 🧪 테스트 (Testing)

- **단위 및 통합 테스트**: `pnpm --filter @baro/desktop test`. `test:watch`, `test:coverage` 옵션을 통해 빠른 피드백과 HTML 리포트(`apps/desktop/coverage/`) 확인 가능

- **E2E 테스트**: `pnpm --filter @baro/desktop test:e2e`. Playwright 기반으로 Electron 실행.
최초 실행 전 브라우저 설치 필요: `pnpm --filter @baro/desktop exec playwright install --with-deps`


- **CI(지속 통합)**: `.github/workflows/ci.yml`에서 `pnpm turbo run type-check lint build`를 실행하며,
OS별 릴리스 워크플로우에는 패키징 단계가 추가됩니다.

***

## 🌐 국제화 (Internationalization)

로컬라이징 문자열은 `apps/desktop/locales/<locale>`에 위치합니다. 타입 안전한 번역 헬퍼를 생성하려면 아래 명령어를 실행하세요:

`pnpm --filter @baro/desktop run i18n:generate-types`

이 스크립트는 `pnpm build` 중 자동으로 실행되며, 커밋 전 훅에서도 강제됩니다.

***

## 📚 문서 (Documentation)

- [apps/desktop/INTEGRATION.md](apps/desktop/INTEGRATION.md) – Electron React Boilerplate 통합 기록 및 업그레이드 가이드