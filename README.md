# Daily

지출·운동·식사·일기·독서를 한 곳에 기록하는 일일 기록 서비스.
지하철이나 식당처럼 신호가 약한 곳에서도 입력이 되어야 한다는 전제로 만든 **오프라인 우선 모바일 웹 PWA**입니다.

---

## 무엇을 기록하나

| 기능 | 단위 | 기록 항목 |
|---|---|---|
| 지출 | 하루 여러 건 | 수입/지출, 금액, 카테고리(사용자 정의), 메모 |
| 운동 | 하루 여러 건 | 종류·부위·세트(횟수·무게) 또는 시간, 강도, 메모 |
| 식사 | 하루 여러 건 | 끼니, 먹은 것, 양(3단계), 칼로리(선택) |
| 일기 | **하루 1건** | 본문 |
| 독서 | 책 목록 + 감상평 N개 | 제목·저자·줄거리, 날짜별 감상평 |
| 통계 | — | 지출 추이, 운동 볼륨·부위별 빈도, 식사 패턴 |

---

## 설계에서 중요한 두 가지

### 오프라인 입력이 나머지 전부를 결정한다

프론트엔드는 "화면"이 아니라 **로컬 DB를 가진 클라이언트**입니다. 이 제약 하나가 다음을 강제합니다.

- **UI는 Dexie(IndexedDB)만 읽고 씁니다.** 화면 컴포넌트는 API를 직접 호출하지 않고, 서버 통신은 `sync/` 계층이 전담합니다. 같은 데이터에 소스가 둘이 되는 순간 동기화가 무너지기 때문입니다. 예외는 인증뿐입니다
- **ID를 서버 채번에만 의존할 수 없습니다.** 오프라인에서 만든 레코드도 즉시 식별자가 있어야 해서, `id`(서버 BIGSERIAL)와 `client_uuid`(클라이언트 생성) 역할을 나눕니다
- **물리 삭제를 하지 않습니다.** 삭제도 다른 기기로 전파되어야 하므로 툼스톤이 남습니다
- **충돌 해결 정책이 필요합니다.** 레코드 단위 last-write-wins를 씁니다

### 규모에 맞는 것만 넣는다

초기 목표는 수십~수백 명입니다. 그래서 **Redis, 메시지 큐, Docker/K8s 배포, 마이크로서비스, GraphQL, 전용 동기화 엔진(RxDB·PowerSync 등), 웹소켓을 도입하지 않습니다.** 이 규모에서는 전부 순수 비용이고, 필요해지는 시점에 다시 판단합니다.

---

## 기술 스택

| 영역 | 선택 |
|---|---|
| 프론트 | React 19, TypeScript, Vite, Tailwind CSS v4 |
| 로컬 저장소 | Dexie (IndexedDB) |
| 상태 관리 | Zustand — UI·세션 상태 전용 |
| PWA | vite-plugin-pwa (Workbox) |
| 백엔드 | Node 22 LTS, TypeScript, Fastify |
| DB 접근 | Drizzle ORM + drizzle-kit |
| 검증 | zod (프론트/백엔드 공유) |
| DB | PostgreSQL 18 |
| 패키지 매니저 | pnpm workspace |
| 배포 | nginx + PM2, VPS 직접 운영 |

---

## 구조

```
daily/
├── apps/
│   ├── web/          # Vite + React PWA
│   │   └── src/
│   │       ├── db/       # Dexie 스키마, outbox 큐
│   │       ├── sync/     # 동기화 엔진 (push/pull, 재시도)
│   │       ├── store/    # Zustand — UI 상태
│   │       ├── features/ # expense/ workout/ meal/ journal/ book/ stats/
│   │       └── pages/
│   └── api/          # Fastify 서버
│       └── src/
│           ├── routes/
│           ├── db/       # drizzle 스키마, 마이그레이션
│           ├── services/
│           └── plugins/  # auth, rate-limit, error-handler
├── packages/
│   └── shared/       # zod 스키마 + 도메인 타입 (프론트·백엔드 공유)
├── deploy/           # nginx 설정 예시
└── docs/
```

`packages/shared`가 이 구조의 핵심입니다. 레코드의 모양을 zod 스키마로 **한 곳에만** 정의하고, 프론트 폼 검증·백엔드 요청 검증·양쪽 타입 추론이 전부 여기서 파생됩니다.

---

## 시작하기

### 요구사항

- Node 22 LTS
- pnpm
- PostgreSQL 18

### 설치

```bash
pnpm install

# 환경변수 — .env.example을 참고해 작성한다. .env는 커밋하지 않는다.
cp .env.example .env
```

`.env`의 `JWT_SECRET`에는 32자 이상의 임의 값을 넣습니다 (`openssl rand -base64 48`).
`POSTGRES_PASSWORD`와 두 `DATABASE_URL`(개발용·테스트용)의 비밀번호 자리에는 같은 값을 넣습니다.

```bash
# 로컬 개발용 PostgreSQL 컨테이너 기동 (docker-compose.yml)
# 호스트 5432가 네이티브 PostgreSQL과 충돌하지 않도록 5438 포트를 씁니다.
docker compose up -d --wait

# daily_test 생성 + daily·daily_test 마이그레이션을 한 번에
pnpm db:setup
```

### 개발

```bash
pnpm dev:api      # API 서버 (http://localhost:3001)
pnpm dev:web      # 프론트 개발 서버 (http://localhost:5173)
```

프론트 개발 서버는 `/api`를 API 서버로 프록시합니다. 개발 중에도 같은 출처를 유지해야 `SameSite=Strict` 리프레시 쿠키가 동작하기 때문입니다.

### 테스트·빌드

```bash
pnpm test         # 전체 테스트
pnpm typecheck    # 전체 타입 체크
pnpm build        # 프로덕션 빌드
```

---

## 진행 상황

설계는 확정됐고, 1단계(기반) 구현이 끝났습니다. **아직 동작하는 서비스가 아닙니다.**

| 영역 | 상태 |
|---|---|
| 설계 (아키텍처·데이터 모델·동기화·인증) | 확정 |
| 모노레포, shared 패키지, KST 시각 유틸 | 완료 |
| Fastify 앱, 전역 에러 핸들러 | 완료 |
| 비밀번호 정책·argon2id 해싱 | 완료 |
| 웹 PWA 셸, Dexie 아웃박스 스키마 | 완료 |
| API 클라이언트, 인증 화면 | 완료 |
| 배포 구성 (PM2·nginx·런북) | 완료 |
| DB 스키마·마이그레이션 (계정·도메인 11개 테이블) | 완료 |
| 토큰 발급·검증, 인증 라우트 | 완료 |
| 동기화 프로토콜 (push/pull, LWW, 툼스톤, 부모-자식) | 완료 |
| 아웃박스 큐·동기화 엔진·미동기화 표시 | 완료 |
| 지출 기록 화면 | 완료 |
| 일기·식사·운동·독서 | 미착수 |
| 약관·개인정보처리방침 | 미작성 (공개 배포 전 필수) |

인증과 동기화 엔진이 동작하고, 지출은 오프라인 입력 → 동기화까지 실제로 됩니다. 동기화 대상 테이블은 아직 지출뿐입니다 — 엔진이 검증되기 전에 5개 도메인을 얹으면 결함이 5배로 번지기 때문입니다. 일기·식사·운동·독서는 [레지스트리](apps/api/src/sync/registry.ts)에 항목을 추가하는 반복 작업으로 이어집니다.

---

## 문서

| 문서 | 내용 |
|---|---|
| [설계 문서](docs/superpowers/specs/2026-08-06-daily-tracker-design.md) | 아키텍처, 데이터 모델, 동기화 프로토콜, 인증, 에러 처리, 테스트 전략 |
| [1단계 구현 계획](docs/superpowers/plans/2026-08-06-phase1-foundation.md) | 태스크별 TDD 구현 계획 |
| [배포 런북](docs/deployment.md) | 최초 설치, 배포 절차, 롤백, 백업 |
| [개발 규칙](.claude/roles/README.md) | DB 규칙, 프로젝트 구조, 보안 |

---

## 개인정보에 대한 알림

운동·식사 기록은 건강 관련 정보로 해석될 여지가 있습니다. 불특정 다수를 대상으로 하는 공개 서비스를 전제하므로, 이용약관·개인정보처리방침과 회원 탈퇴 시 데이터 파기 절차가 **공개 배포 전에 반드시** 필요합니다. 아직 작성되지 않았습니다.
