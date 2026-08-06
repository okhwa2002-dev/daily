# 프로젝트 구조와 기술 스택

오프라인 입력을 지원하는 일일 기록 PWA. 정적 SPA + 독립 API 서버 구성.

---

## 기술 스택

| 영역 | 선택 |
|---|---|
| 프론트 | React 19, TypeScript, Vite, Tailwind CSS v4 |
| 로컬 저장소 | Dexie (IndexedDB) |
| 상태 관리 | Zustand — UI/세션 상태 전용 |
| PWA | vite-plugin-pwa (Workbox) |
| 차트 | Recharts |
| 폼 | react-hook-form + zod |
| 백엔드 | Node 22 LTS, TypeScript, Fastify |
| DB 접근 | Drizzle ORM + drizzle-kit |
| 검증 | zod (프론트/백엔드 공유) |
| 로깅 | pino |
| DB | PostgreSQL 18 |
| 패키지 매니저 | pnpm (workspace) |
| 배포 | nginx + PM2, VPS 직접 운영 |

### 도입하지 않는 것

Redis, 메시지 큐, Docker/K8s 배포, 마이크로서비스, GraphQL, 전용 동기화 엔진(RxDB/PowerSync 등).
초기 규모(수십~수백 명)에서는 전부 순수 비용이다. 필요해지는 시점에 다시 판단한다.

---

## 디렉터리 구조

```
daily/
├── apps/
│   ├── web/                    # Vite + React PWA
│   │   ├── src/
│   │   │   ├── db/             # Dexie 스키마, outbox 테이블
│   │   │   ├── sync/           # 동기화 엔진 (push/pull, 재시도, 온라인 감지)
│   │   │   ├── store/          # Zustand — UI 상태
│   │   │   ├── features/       # expense/ workout/ meal/ journal/ book/ stats/
│   │   │   ├── components/     # 공용 UI
│   │   │   ├── pages/
│   │   │   └── lib/
│   │   └── vite.config.ts
│   └── api/                    # Fastify 서버
│       ├── src/
│       │   ├── routes/
│       │   ├── db/             # drizzle 스키마, 마이그레이션
│       │   ├── services/       # 도메인 로직
│       │   └── plugins/        # auth, rate-limit, error-handler
│       └── drizzle.config.ts
├── packages/
│   └── shared/                 # zod 스키마 + 도메인 타입
└── docs/
```

---

## 아키텍처 원칙

### UI는 Dexie만 읽는다

화면 컴포넌트는 API를 직접 호출하지 않는다. 읽기·쓰기 모두 로컬 Dexie를 거치고, 서버 통신은 `sync/` 계층이 전담한다.

온라인일 때만 서버에서 직접 읽는 최적화는 넣지 않는다. 같은 데이터에 소스가 둘이 되는 순간 동기화가 무너지고, 오프라인 분기 코드가 화면 전체로 번진다.

예외는 인증(로그인/회원가입)뿐이다.

### 기능 단위 분리

`features/` 아래 각 폴더는 자기 화면·로컬 쿼리·타입을 소유한다. 지출·운동·식사·일기·독서는 서로 독립적이므로 한 기능을 고칠 때 다른 기능을 건드리지 않아야 한다.

공용으로 올릴지 판단이 서지 않으면 일단 feature 안에 둔다. 두 번째 사용처가 생겼을 때 `components/`로 올린다.

### 스키마는 shared에 한 번만 정의한다

도메인 레코드의 모양은 `packages/shared`의 zod 스키마가 유일한 정의다. 프론트 폼 검증, 백엔드 요청 검증, 양쪽 타입 추론이 모두 여기서 파생된다. 타입을 양쪽에 복사하지 않는다.

### id와 client_uuid의 역할 구분

| | 용도 |
|---|---|
| `id` (BIGSERIAL) | DB 내부 식별자, FK, 인덱스 |
| `client_uuid` (UUID) | 동기화 식별자. 오프라인 생성, 중복 전송 방지 |

로컬 레코드 간 참조는 `client_uuid`로 하고, 서버 전송 시점에 `id`로 치환한다. 이 변환은 `sync/` 계층 안에만 존재하며 화면 코드로 새어나가지 않는다.

---

## 개발 명령어

```bash
pnpm install
pnpm --filter web dev          # 프론트 개발 서버
pnpm --filter api dev          # API 서버
pnpm --filter api db:migrate   # 마이그레이션 적용
pnpm test
pnpm build
```
