# Posely Desktop 통합 노트 (Integration Notes)

이 문서는 Electron React Boilerplate를 Posely Turborepo에 통합하면서 발생한 변경사항을 기록합니다.

***

## 워크스페이스 통합

- 패키지명을 `@baro/desktop`으로 변경하고 Turborepo 워크스페이스에 등록
- 스크립트를 `pnpm` 기반으로 변경하고 Turbo 파이프라인(`dev`, `build`, `lint`, `type-check`)에 통합
- `@heroui/react`, `@heroui/theme`, `framer-motion`, `@baro/eslint-config`, `@baro/typescript-config` 등 공용 의존성 추가
- TypeScript 설정은 `@baro/typescript-config/base.json`을 상속하며, `@baro/*` 경로 매핑 지원


## 빌드 구성

- Webpack 기본 설정이 `packages/` 폴더의 워크스페이스 패키지까지 트랜스파일하도록 수정
- 메인 프로세스 Webpack 엔트리에 워커 번들을 추가하여 main/preload와 함께 빌드
- `release/app/package.json`을 `pnpm` 기반 설치 구조로 업데이트

## IPC 및 워커 구조

- 공용 IPC 채널 정의: `src/shared/ipcChannels.ts`
- 메인 프로세스에서 전용 워커 스레드(`src/worker/index.ts`)를 실행하고 메시지를 렌더러로 전달
- 렌더러는 메인/워커 상태를 실시간으로 표시하는 ping/pong 액션 제공
- `preload.ts`에서 채널 유효성을 검증하도록 IPC 브릿지 강화

## 렌더러 업데이트

- `@heroui/react` 기반 UI로 통합 진단 화면(main 응답, worker 상태, worker 응답) 표시
- 리스너가 등록되면 자동으로 워커 상태 요청을 전송하여 상태 동기화 유지

---

## 개발 명령어

```bash
pnpm dev        # 개발 모드 실행 (Turborepo)
pnpm build      # main + renderer 빌드
pnpm package    # electron-builder로 배포용 패키징
pnpm lint       # 공통 ESLint 설정으로 린트 검사
pnpm type-check # main/renderer/worker 타입 검증
```

## 환경 분리 및 CI/CD

**로컬 개발용 설치** - `pnpm run desktop:install:dev` 실행 시 `BARO_SKIP_ELECTRON_BUILDER=1`로 설정되어 Electron Builder의 네이티브 의존성 리빌드를 건너뜁니다.
이후 pnpm run desktop:dev로 Turbo를 통해 데스크톱 워크스페이스 실행

**패키징** - `pnpm run desktop:package` 또는 `pnpm --filter @baro/desktop package` 를 실행하여 `release/build/` 폴더에 플랫폼별 아티팩트를 생성합니다.
macOS에서는 Apple Developer/Distribution 인증서가 필요하며, 서명 없이 빠르게 테스트하려면 `CSC_IDENTITY_AUTO_DISCOVERY=false`와 빈 `CSC_NAME`을 설정합니다.

**CI/CD** - `.github/workflows/ci.yml`은 `--frozen-lockfile` 옵션으로 설치 후 `pnpm turbo run type-check lint build`를 실행합니다.
릴리스 태그 생성 시 `.github/workflows/release.yml`이 실행되어 OS별 빌드 및 패키징을 수행하고 결과물을 업로드합니다.

## 업그레이드 참고사항

- Electron React Boilerplate 업스트림 변경사항을 가져올 경우 `.erb/` 구성 변경을 확인하고 Turbo 스크립트로 재검증

- 새로운 의존성이 `pnpm workspace` 및 공용 설정과 호환되는지 확인

- 프로세스 간 호환성을 유지하기 위해 `src/shared/ipcChannels.ts` 내 메시지 계약을 최신 상태로 유지