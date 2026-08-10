# 최종 브랜치 리뷰 — phase1-foundation (93fdcfe..539587f)

리뷰 범위: 브랜치 전체. 태스크별 리뷰가 이미 통과한 개별 결함은 재론하지 않고, 태스크 **사이**에서 생긴 문제와 병합 가부에만 집중했다.

---

### Verdict

**Merge after fixing the blockers below.**

인증 스택 자체의 코드 품질은 좋다. 토큰 로테이션의 선점 UPDATE, 로그인 타이밍 채널 차단, refresh 시점 계정 상태 재검사 — 태스크 리뷰가 잡아낸 것들이 제대로 반영돼 있고, 주석이 "무엇을" 이 아니라 "왜 이렇게 안 하면 깨지는가"를 설명한다. 막는 것은 인증 로직이 아니라 그 **주변**이다: 이 브랜치가 처음으로 실제 자격증명을 3001 포트에 올렸는데 그 포트는 여전히 `0.0.0.0`에 열려 있고, `req.ip`가 이번에 처음으로 보안 결정에 쓰이기 시작했는데 그 값이 공격자 통제 하에 있으며, 브랜치가 추가한 개발용 DB는 커밋된 파일만으로는 기동되지 않아 이 브랜치의 테스트 스위트를 새 클론에서 돌릴 수 없다. 넷 다 한 줄~몇 줄짜리 수정이다.

---

### Blockers

#### B1. API가 모든 인터페이스에 바인딩된다 — nginx/TLS를 우회해 평문으로 로그인이 가능하다

`apps/api/src/main.ts:5`

```ts
await app.listen({ port: env.PORT, host: '0.0.0.0' })
```

`deploy/nginx.conf.example:27`은 `proxy_pass http://127.0.0.1:3001`로 루프백만 쓰고, `docs/deployment.md`의 최초 설치 절차(6~34행)에는 방화벽 단계가 **없다**(`git grep -iE "ufw|firewall|방화벽"` → 0건). 따라서 VPS에 배포하는 순간 `http://<VPS-IP>:3001/api/auth/login`이 인터넷에 그대로 열린다.

실패 시나리오: 공격자(또는 그냥 스캐너)가 평문 HTTP로 `/api/auth/login`을 호출한다. 이메일·비밀번호가 네트워크에 평문으로 흐르고, 응답 본문의 `accessToken`도 평문으로 나간다. `COOKIE_SECURE=true`라 리프레시 쿠키만 안 붙을 뿐, 액세스 토큰은 본문에 있으므로 인증은 완전히 성립한다. certbot으로 TLS를 붙인 의미가 사라진다.

`host: '0.0.0.0'`과 `trustProxy: true`는 Task 3(이미 main) 산물이지만, **그 포트에 자격증명이 올라간 것은 이 브랜치다.** 병합 시점이 고칠 시점이다.

수정: `main.ts:5`을 `host: '127.0.0.1'`로. nginx가 어차피 루프백으로만 붙는다. 추가로 `docs/deployment.md` 최초 설치에 `sudo ufw allow 22,80,443/tcp && sudo ufw enable` 한 줄.

#### B2. `trustProxy: true` + `$proxy_add_x_forwarded_for` = `req.ip`가 공격자 통제 값이다

`apps/api/src/app.ts:22` / `deploy/nginx.conf.example:31`

nginx는 `$proxy_add_x_forwarded_for`로 클라이언트가 보낸 XFF **뒤에 실제 IP를 덧붙인다**. Fastify의 `trustProxy: true`는 proxy-addr에 "모든 홉을 신뢰"를 지시하므로 체인의 **가장 왼쪽**, 즉 전적으로 클라이언트가 쓴 값이 `req.ip`가 된다.

이 브랜치 이전에는 `req.ip`가 로그에만 쓰였다. 이제는 두 곳에서 보안 결정을 내린다:

- `apps/api/src/app.ts:28-42` — `@fastify/rate-limit`의 기본 keyGenerator가 `req.ip`다. 공격자가 요청마다 `X-Forwarded-For: <랜덤>`을 붙이면 분당 300 제한이 **완전히 무력화**된다. 이 브랜치가 추가한 유일한 무차별 대입 방어선이 그것 하나다.
- `apps/api/src/routes/auth.ts:67` → `throttle.ts:15-20` — `login_attempts.ip`에 임의의 IP를 심을 수 있다. 침해 조사 시 로그가 공격자가 지목한 무고한 IP를 가리킨다.

수정: `trustProxy: 1` (또는 `'127.0.0.1'`). 홉 하나만 신뢰하면 proxy-addr가 오른쪽에서 한 칸 안쪽, 즉 nginx가 덧붙인 실제 IP를 고른다.

#### B3. 새 클론에서 이 브랜치의 테스트 스위트를 돌릴 수 없다

이 브랜치가 `docker-compose.yml`(commit ec216de)로 개발 DB 절차를 바꿨는데, 맞물리는 파일들이 하나도 따라오지 않았다. 확인한 사실:

| 사실 | 근거 |
|---|---|
| compose는 `POSTGRES_PASSWORD:?`로 값이 없으면 기동을 거부한다 | `docker-compose.yml:19` |
| `.env.example`에 `POSTGRES_*` 키가 하나도 없다 | `.env.example` 전문 (이 브랜치에서 미수정) |
| compose 기본 호스트 포트는 5438인데 `.env.example`의 `DATABASE_URL`은 5432를 가리킨다 | `docker-compose.yml:33` vs `.env.example:6-7` |
| compose가 `./deploy/initdb`를 마운트하지만 그 디렉터리는 비어 있고 git에 없다 | `git ls-files deploy/` → `nginx.conf.example` 뿐 |
| `daily_test` DB를 만드는 것이 저장소 안에 없다 | compose의 `POSTGRES_DB`는 `daily`만 만든다 |
| `daily_test`에 마이그레이션을 거는 것도 없다 | `apps/api/drizzle.config.ts:8`이 무조건 `env.DATABASE_URL` |
| README는 아직 네이티브 PG + `createdb` + 5432 이야기를 한다 | `README.md:96-98`, compose를 언급조차 안 함 |

계획서 `docs/superpowers/plans/2026-08-06-phase1-foundation.md:1003`이 "`daily`와 `daily_test`는 이미 만들어져 있으므로 `createdb`를 다시 실행하지 않는다"라고 적은 것이 이 구멍의 출처다. "이미 만들어져 있다"는 것은 컨트롤러의 로컬 상태이지 저장소의 상태가 아니다. 결과적으로 이 브랜치가 추가한 48개 API 테스트는 **저자의 기계에서만 재현된다.**

수정(택1, 어느 쪽이든 저장소만으로 완결되어야 한다):
- `deploy/initdb/01-create-test-db.sql`에 `CREATE DATABASE daily_test;`를 커밋하고, `.env.example`에 `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`/`POSTGRES_PORT`를 추가하고, `DATABASE_URL`/`DATABASE_URL_TEST`의 포트를 5438로 맞추고, `daily_test` 마이그레이션 방법(`DATABASE_URL=$DATABASE_URL_TEST pnpm --filter @daily/api db:migrate` 등)을 README에 적는다.
- 또는 compose를 개발용 단일 경로로 확정하고 README의 `createdb` 절차를 대체한다.

어느 쪽이든 README의 진행 상황 표(`README.md:130-133`)도 함께 고친다 — "DB 스키마·마이그레이션 미완 / 토큰 발급·검증, 인증 라우트 미완"은 이 브랜치가 거짓으로 만든 문장이다. 공개 저장소의 첫 화면이다.

#### B4. `COOKIE_SECURE=false`를 설정할 방법이 없다 (검증 완료)

`apps/api/src/env.ts:20`

```ts
COOKIE_SECURE: z.coerce.boolean().default(true),
```

`z.coerce.boolean()`은 `Boolean(input)`이다. 실제로 확인했다:

```
z.coerce.boolean().parse('false') -> true
z.coerce.boolean().parse('0')     -> true
```

`.env.example:14`가 `COOKIE_SECURE=false`를 안내하지만 그 값은 `true`가 된다. 빈 문자열로 둘 때만 `false`가 되고, 그건 아무도 예상하지 못한다.

실패 시나리오: 모바일 우선 PWA를 실기기에서 확인하려고 `http://192.168.0.x:5173`으로 접속한다. 리프레시 쿠키에 `Secure`가 붙어 브라우저가 조용히 버린다. 에러도 경고도 없이 새로고침마다 로그아웃되고, 개발자는 `.env`에 `COOKIE_SECURE=false`가 적혀 있으니 쿠키 설정을 의심하지 않는다. (`localhost`는 Chrome이 보안 컨텍스트로 취급해 통과하므로 증상이 실기기에서만 나타난다 — 최악의 형태다.)

수정: `z.enum(['true','false']).default('true').transform(v => v === 'true')`.

---

### Fix early in phase 2

**P1. `requireAuth`가 계정 상태를 보지 않는다 — 정지·탈퇴가 최대 15분간 무효다.**
`apps/api/src/plugins/require-auth.ts:12-18`은 JWT 서명만 검증한다. Task 8 리뷰가 "로그인에서만 막으면 이미 로그인해 둔 사용자는 refresh로 세션을 무한 연장한다"를 잡아 `/auth/refresh`를 고쳤지만(`routes/auth.ts:107-119`), 액세스 토큰 경로는 그대로다. `ACCESS_TOKEN_TTL_SEC=900`이므로 정지·탈퇴된 계정이 15분간 모든 보호 라우트를 정상 사용한다. 2단계에서 requireAuth가 5개 도메인 테이블 전체를 지키게 되면, **파기 요청을 낸 계정이 15분간 계속 건강 관련 기록을 읽고 쓸 수 있다**는 뜻이 된다.
같은 구멍이 재사용 탐지의 보장도 깎아먹는다. `tokens.ts:100-103`의 주석은 "공격자와 정상 사용자를 구분할 수 없으므로 양쪽 다 끊는다"고 선언하지만, 끊기는 건 리프레시 토큰뿐이다. 탈취자의 액세스 토큰은 최대 15분 더 살아 있다. 주석이 약속하는 보장과 코드가 제공하는 보장이 다르다 — 최소한 이 15분 창을 명시적으로 문서화하고 수용하거나, requireAuth에 상태 조회를 넣어야 한다.

**P2. `/auth/register`가 계정 열거 오라클이다 — Task 8이 로그인에 들인 노력을 무효화한다.**
`routes/auth.ts:37-40`은 이미 가입된 이메일에 409 `EMAIL_ALREADY_EXISTS`를 준다. Task 8 리뷰는 로그인의 argon2 단축 평가를 **타이밍** 채널이라는 이유로 막았고(`password.ts:44-47`의 `dummyPasswordHash`), 테스트도 응답 본문 동일성을 검증한다(`auth.test.ts:69-83`). 그런데 바로 옆 라우트가 같은 정보를 상태 코드로 그냥 알려준다. 심지어 register는 `loginDelayMs` 스로틀 대상도 아니라 열거 속도에 제한이 없다.
건강 관련 데이터를 다루는 공개 서비스에서 "이 이메일이 이 서비스를 쓴다"는 사실 자체가 노출 대상이다. 정공법은 이메일 인증 기반 가입(가입 여부와 무관하게 200 + 메일 발송)이고, 그건 계획서가 `phase1b-account-recovery`로 미뤄둔 항목과 정확히 같은 선행 조건(메일 서비스 선정)을 공유한다. **`phase1b`를 공개 배포의 명시적 선행 조건으로 못 박아라.**

**P3. 2단계 동기화가 쓸 "클라이언트 시각 정규화" 함수가 없고, 있는 함수는 함정이다.**
`database.md`는 "클라이언트가 보낸 `updated_at`은 서버 진입 시점에 KST로 정규화한 뒤 저장한다. 정규화를 빠뜨리면 기기 타임존이 다를 때 최신 판정이 뒤집힌다"고 규정한다. `packages/shared/src/datetime.ts`가 내놓는 것은 `toKstTimestamp(Date)`와 `fromKstTimestamp(string)` 둘뿐이고, **인바운드 문자열 → KST 벽시계 문자열** 함수는 없다.
이름만 보면 `fromKstTimestamp`가 그 자리처럼 보이는데, 그것은 이미 KST 벽시계인 문자열을 가정하고 `+09:00`을 덧붙인다(`datetime.ts:16`). 오프셋이 붙은 진짜 ISO를 넣으면 조용히 깨진다. 실행해서 확인했다:

```
fromKstTimestamp('2026-08-10T05:20:00.000Z')      -> Invalid Date
fromKstTimestamp('2026-08-10T05:20:00.000+00:00') -> Invalid Date
```

throw하지 않고 `Invalid Date`를 반환하므로 `.getTime()`이 `NaN`이 되어 비교가 전부 `false`가 되고, last-write-wins가 조용히 "아무것도 안 덮어씀"으로 퇴화한다. 2단계 첫 커밋에서 `normalizeClientTimestamp(input: string): string`을 shared에 추가하고, 오프셋 없는 입력은 **거부**하도록 해라(오프셋 없는 값을 KST로 가정하는 순간 규칙이 막으려던 바로 그 버그가 된다).

**P4. 소유권 격리를 "쉽게 맞추게" 하는 장치가 하나도 없다.**
2단계는 5개 테이블 × CRUD ≈ 20개 이상의 쿼리 지점을 추가하고, 그 전부가 `user_id = :userId`와 `deleted_at IS NULL`을 빠뜨리면 안 된다. 현재 기반이 제공하는 것은 전역 `db` 싱글턴(`db/pool.ts:19`)뿐이다. 구체적으로:
- `project-structure.md`와 `README.md:70`이 약속한 `apps/api/src/services/` 디렉터리가 없다. 유일한 선례인 `routes/auth.ts`가 라우트에서 `db.select().from(users)`를 직접 부르므로, 따라 쓰는 구현자는 **소유권 조건이 없는 템플릿**을 복사하게 된다(auth 라우트에서는 그게 맞지만 도메인 라우트에서는 취약점이다).
- 누락을 잡아줄 것이 아무것도 없다 — 헬퍼도, 린트 규칙도, "다른 사용자 데이터가 안 보인다"를 검사하는 테스트 템플릿도 없다.
- `refresh_tokens.user_id` / `password_reset_tokens.user_id`에 `users`로 가는 FK가 없다(`drizzle/0000_clammy_the_leader.sql`). 도메인 테이블도 이 선례를 물려받을 텐데, 탈퇴 시 데이터 파기 요구사항과 정면으로 부딪힌다.
- 코드값 컬럼이 `text()`로만 선언돼 있어 타입 검사를 못 받는다. `db.update(users).set({ status: 'ACTIV' })`가 타입 체크를 통과하고 런타임 CHECK 위반으로 500이 된다. drizzle은 `text('status', { enum: USER_STATUS })`를 지원하고 `packages/shared/src/codes.ts`에 이미 상수가 있다 — 2단계 전에 연결해 두면 도메인 테이블 전체가 공짜로 이득을 본다.
권고: `db/` 아래에 `scopedTo(table, userId)` 같은 조건 빌더 + 교차 계정 격리 테스트 헬퍼를 2단계 첫 태스크로 만들고, 도메인 테이블 정의는 `text({ enum })`으로 시작해라.

**P5. 스로틀이 순차 공격자만 막고, 피해자를 괴롭히는 데는 쓰인다.**
`routes/auth.ts:69`는 지연을 **계산·적용한 뒤** `recordAttempt`를 호출한다(`auth.ts:86`). 따라서 동일 이메일로 1000개 요청을 동시에 쏘면 전부 공격 이전 상태를 읽고 전부 지연 0으로 통과한다. 지수 지연은 요청을 직렬로 보내는 공격자에게만 유효하다. 또 `loginDelayMs`가 이메일만 키로 쓰므로(`throttle.ts:24-27`), (a) 여러 이메일에 분산하는 크리덴셜 스터핑은 전혀 제한되지 않고, (b) 반대로 특정 계정에 실패를 10번 심어 두면 그 피해자는 로그인마다 30초를 기다린다. `ip` 컬럼을 저장해 두고 판정에 쓰지 않는 것이 아깝다. B2를 고친 뒤 IP 축을 추가하고, 지연 대신 카운터 선증가를 검토해라.

**P6. 공개 서비스에 내놓기 전 필요한 것들 (지금 막지는 않지만 아무 태스크도 소유하지 않았다).**
- **argon2 + 무제한 가입 = 값싼 DoS.** `hashPassword`(`password.ts:32`)는 libuv 스레드풀(기본 4)에서 돈다. 가입에 이메일 인증도 CAPTCHA도 없고 IP당 300/분이 허용되므로(B2로 그마저 우회 가능), 수십 개 동시 요청이면 스레드풀이 포화돼 API 전체가 멎는다. `users.email_verified_at` 컬럼은 만들어졌지만 아무도 쓰지 않는다.
- **`login_attempts`와 `refresh_tokens`에 보존 정책이 없다.** 둘 다 무한 증가하고, 전자는 이메일+IP(개인정보)를 영구 보관한다. `security.md`의 "수집 항목을 최소화한다"와 충돌한다. 리프레시는 15분 액세스 토큰 기준 사용자당 하루 96행씩 쌓인다. `docs/deployment.md`의 cron에는 pg_dump만 있고 정리 작업이 없다.
- **절대 세션 수명이 없다.** 로테이션마다 DB 만료(`tokens.ts:41-44`)와 쿠키 maxAge(`routes/auth.ts:24`)가 모두 30일로 재설정되므로, 30일에 한 번만 접속하면 세션이 영원히 산다.
- **`users_email_uq`가 소프트 삭제 행을 제외하지 않는다.** 탈퇴 흐름이 생기는 순간 탈퇴자의 이메일이 영구히 재가입 불가가 된다. 스키마 결정이라 나중에 바꾸려면 마이그레이션이 필요하다 — 탈퇴 기능을 만들기 **전에** 정해라. Task 8의 이연 항목(가입 존재 검사에 `deleted_at IS NULL` 없음)과 같은 뿌리다.
- **PWA manifest에 아이콘이 없어 설치가 안 된다**(Task 10 이연 항목). 모바일 PWA가 제품의 전제인데 설치가 안 되면 전제가 무너진다.

**P7. 테스트가 지키는 대상과 커버리지가 어긋난 두 지점.**
- **리프레시 토큰 만료 검사가 전혀 테스트되지 않는다.** `tokens.ts:107`의 `claimed.expiresAt <= now`는 KST 스킴 전체에서 **유일한 순서 비교**인데, 만료된 토큰을 만드는 테스트가 없다. 이 비교가 반전되거나 형식이 깨져도 48개 테스트가 전부 통과한다. 실패 모드: 6개월 지난 탈취 쿠키가 계속 통과한다. (비교 자체는 지금 옳다 — PG의 ISO DateStyle 하에서 `YYYY-MM-DD HH:MM:SS[.f]`는 사전순 = 시간순이다. 다만 그건 `DateStyle`이 기본값이라는, 어디에도 고정돼 있지 않은 전제 위에 있다.)
- **로그인 타이밍 오라클 수정에 회귀 테스트가 없다.** `auth.test.ts:69-83`은 응답 코드·메시지 동일성만 본다. `dummyPasswordHash`를 지워도 그 테스트는 초록색이다 — Task 8 리뷰가 찾아낸 바로 그 취약점이 조용히 되돌아올 수 있다.

**P8. 자잘하지만 확실히 틀린 것들.**
- `packages/shared/src/auth.ts:5`가 `password: z.string().min(10).max(128)`를 강제하므로 `password.ts:19-28`의 `PASSWORD_TOO_SHORT`/`PASSWORD_TOO_LONG` 분기는 라우트를 통해 **도달 불가능**하다(zod가 먼저 `VALIDATION_FAILED`로 400을 낸다). 같은 상수가 두 곳에 복제돼 있고, 클라이언트가 받을 수 없는 에러 코드가 계약에 존재한다.
- `login_attempts.succeeded`가 `'Y'/'N'`(`schema.ts:66`)인데 `packages/shared/src/codes.ts`의 코드 레지스트리에 등록돼 있지 않다. 레지스트리 주석은 "새 코드 그룹을 추가하면 여기에도 넣는다"고 요구한다.
- `routes/auth.ts:43-54`의 가입이 INSERT + UPDATE 두 문장으로 나뉘어 있고 트랜잭션이 아니다. UPDATE가 실패하면 `created_by = 0`인 사용자가 남는다. `.returning()` 대신 CTE 하나로 처리하거나, `_by`에 `0`(시스템 sentinel)을 그대로 두는 것도 규칙상 허용된다.
- `apps/api/package.json`에 `@fastify/cors`가 dependency로 있는데 어디서도 등록하지 않는다. 같은 출처 구성이므로 필요 없다 — 지워라.

---

### Deferred-minor triage

| # | 이연 항목 | 판정 | 이유 |
|---|---|---|---|
| T1 | `engines`로 Node 22 고정 없음 | **phase 2** | CI를 붙일 때 함께. 지금은 아무도 다치지 않는다 |
| T2 | 연말 경계 왕복 테스트 없음 | **leave open** | 고정 오프셋 산술이라 경계에 특별한 분기가 없다. 이미 있는 날짜 경계 테스트로 충분 |
| T2 | `.slice(0,23)`이 4자리 연도 가정 | **leave open** | 서비스 수명 밖 |
| T3 | 비검증 `FastifyError`의 `statusCode` 미보존 (깨진 JSON → 500) | **phase 2, 이른 쪽** | 공개 클라이언트가 실제로 밟는다. 500이 되면 catch-all 분기가 `err` 전문을 error 레벨로 로깅해 잡음까지 만든다. `err.statusCode` 한 줄 |
| T3 | `err.validation` 분기와 404 핸들러 미커버 | **leave open** | 로직이 없는 분기다. 위 항목을 고칠 때 테스트가 자연히 따라온다 |
| T5 | 비밀번호 블록리스트 15개뿐 | **공개 배포 전 (phase 2 아님, merge 아님)** | 지금은 "정책이 있다"이지 "통제가 있다"가 아니다. 병합은 막지 않되 launch 체크리스트 항목 |
| T5 | 경계값(정확히 10/128자) 미테스트 | **leave open** | P8의 상수 중복을 정리할 때 함께 |
| T7 | 교차 계정 격리 테스트가 이력 0인 계정만 확인 | **phase 2, 반드시** | 이 테스트가 2단계에서 5개 도메인 테이블로 복제될 **격리 테스트 원형**이다. 약한 원형을 20번 복사하게 된다. 지금 양쪽에 독립적인 non-zero 이력을 주도록 강화해라 |
| T7 | `fileParallelism:false` 영구화 | **leave open** | 명시된 트리거(순차 실행이 실제로 아플 때)에 재검토. 현재 48개 테스트에서는 옳은 선택 |
| T4 | drizzle 생성 파일에 개행 없음 | **leave open** | 생성물. 손대면 다음 generate에서 되돌아온다 |
| T4 | `setTypeParser`가 프로세스 전역 부수효과 | **leave open (주석 보강)** | "pool.ts가 유일한 pg importer"라는 불변식이 강제되지 않는다. pool.ts에 그 불변식을 명시하는 주석 한 줄이면 족하다 |
| T6 | `replacedBy` 채우려 추가 SELECT | **phase 2** | `issueRefreshToken`이 id를 반환하게 하면 사라진다. 2줄 |
| T8 | 가입 존재 검사에 `deleted_at IS NULL` 없음 | **phase 2** | 단독으로는 도달 불가. P6의 `users_email_uq` 결정과 **묶어서** 판단해야 한다 — 따로 고치면 유니크 인덱스와 모순된다 |
| T8 | 가입 select-then-insert 경쟁 → 409 대신 500 | **phase 2** | 23505를 잡아 409로. 동시 가입은 실제로 일어난다(더블 탭) |
| T9 | 빈 토큰 가드 없음 / rate limit이 로그인 스코프가 아님 / 429 경로 미커버 | **분리**: 빈 토큰 **leave open**(`Bearer ` → jwtVerify가 던져 401, 동작이 이미 옳다); 로그인 스코프 **공개 배포 전**(P5와 동일 사안); 429 커버리지는 Task 9 수정에서 이미 해소됨 |
| T10 | tsconfig include가 vite/vitest 설정 누락 | **phase 2** | 설정 파일의 타입 오류가 안 잡힌다. 한 줄 |
| T10 | PWA manifest에 아이콘 없음 → 설치 불가 | **공개 배포 전, 우선순위 높음** | 모바일 PWA가 제품 전제다 |
| T11 | `init.body` 재사용이 ReadableStream 본문에서 깨짐 | **leave open** | 전부 JSON 문자열 본문이다. 스트림 본문을 쓰게 되는 날 터지지만 그날 명확히 터진다 |
| T11 | `refresh()`가 `{accessToken}`, `session.ts`는 `AuthResponse` | **이제 처리 가능 — phase 2 첫 커밋** | 이연 사유가 "Task 8이 공유 타입을 내놓으면"이었고 **Task 8이 이미 내놨다**(`packages/shared/src/auth.ts:15`). `session.ts`는 이미 shared에서 import하는데 `apiClient.ts:33`만 로컬 인라인 타입으로 남았다. 조건이 충족된 이연 항목이므로 더 미룰 근거가 없다 |
| T11 | `res.json() as AuthResponse`가 zod parse가 아닌 무검증 단언 | **phase 2** | 같이 고쳐라. 다만 `AuthResponse`가 zod 스키마가 아니라 맨 `interface`인 것이 근본 원인이고, 이것 자체가 "레코드의 모양은 zod 스키마가 유일한 정의" 규칙에서 벗어나 있다 |
| T11 | `RegisterPage.tsx` 테스트 없음 | **leave open** | `LoginPage`와 같은 훅·같은 경로를 쓴다. 중복 커버리지 |
| T12 | 배포 절차의 맨 `git pull`이 클론을 전제 | **leave open** | 최초 설치 절에서 이미 해소됨 |

---

### Cross-task seams

태스크 경계에서 찾은 것들 (위에 이미 다룬 것은 참조만):

1. **Task 3의 인프라 선택이 Task 7·9에서 보안 결정이 됐는데 아무도 재평가하지 않았다.** `trustProxy: true`(Task 3)는 로그 필드에만 영향을 줄 때는 무해했다. Task 7이 `login_attempts.ip`를, Task 9가 rate limit 키를 거기에 얹으면서 신뢰 경계가 바뀌었지만 Task 3의 결정은 그대로다 → **B2**. 같은 구조로 `host: '0.0.0.0'`(Task 3)이 Task 8에서 자격증명 엔드포인트를 얻으며 위험해졌다 → **B1**. 태스크별 리뷰가 원리적으로 잡을 수 없는 유형이다.

2. **Task 8이 로그인의 계정 열거를 막았는데 같은 파일의 가입 라우트가 그대로 흘린다** → **P2**. 두 라우트가 같은 태스크에 속했는데도 브리프가 로그인 타이밍만 지목해서 생긴 사각지대다.

3. **Task 8이 refresh에서 계정 상태를 검사하게 만든 그 논리가 Task 9의 `requireAuth`에는 적용되지 않았다** → **P1**. 두 태스크가 같은 위협("정지가 무의미해진다")을 각자의 브리프 범위에서만 처리했다.

4. **Task 1의 코드값 레지스트리와 Task 4의 스키마가 연결되지 않았다.** `codes.ts`가 `USER_STATUS`를 export하는데 `schema.ts:22`는 맨 `text()`를 쓰고, `login_attempts.succeeded`는 레지스트리에 없는 새 코드 그룹을 인라인 주석으로 정의한다 → **P4/P8**. shared가 단일 정의여야 한다는 원칙이 DB 층 경계에서 끊겼다.

5. **Task 1의 `.env.example`과 이 브랜치의 `docker-compose.yml`이 서로를 모른다** → **B3**. 여기에 main에 있던 Task 12의 README까지 합쳐 로컬 DB 이야기가 서로 모순되는 두 벌 존재한다.

6. **Task 5의 비밀번호 정책과 Task 1의 zod 스키마가 같은 상수를 각자 들고 있다** → **P8**. 아직 어긋나지 않았지만 한쪽만 고치면 조용히 어긋난다. 한쪽 분기는 이미 도달 불가다.

7. **Task 2의 datetime 유틸이 2단계가 요구하는 방향의 변환을 제공하지 않고, 이름이 가장 비슷한 함수는 오용 시 `Invalid Date`를 조용히 낸다** → **P3**. 1단계 안에서는 아무도 밟지 않으므로 태스크별 리뷰가 볼 수 없었다.

**깨끗한 이음매도 기록해 둔다.** 에러 계약(`{ error: { code, message, requestId } }`)은 zod/AppError/validation/catch-all/404/429 여섯 경로 전부에서 일관된다 — Task 9의 `errorResponseBuilder`가 본문을 손으로 만들지 않고 `AppError`를 반환해 기존 핸들러로 되돌린 것은 계획서가 지시한 것보다 나은 선택이다(계획서 2101-2110행은 본문을 복제하라고 했다). 에러 코드 간 중복이나 모순도 없다. `revoked_by` sentinel 규약(0 = 시스템, userId = 본인 행위)은 `tokens.ts`의 세 경로에서 일관되고 세 개의 테스트가 각각을 고정한다.

---

### What is genuinely good here

칭찬을 위한 칭찬이 아니라, 요약이 한쪽으로 기울지 않도록 적는다.

- **주석이 실제로 값을 한다.** `tokens.ts:74-80`은 "왜 단일 UPDATE인가"를 설명하면서 select-then-update가 어떻게 재사용 탐지를 **조용히** 무력화하는지를 적어 놓았다. `routes/auth.ts:111-113`, `password.ts:50-54`, `pool.ts:11-14`, `apiClient.ts:52-55`도 같다. 전부 "이 코드가 없으면 무슨 사고가 나는가"를 적었지 "이 코드는 무엇을 한다"를 적지 않았다. 6개월 뒤에 이 방어들을 리팩터링으로 지워버릴 확률을 실제로 낮추는 종류의 주석이다.

- **테스트가 자기가 무엇을 지키는지 안다.** `tokens.test.ts:89-93`은 동시성 테스트가 커넥션 핸드셰이크 지연 때문에 **고치기 전 코드에서도 우연히 통과할 수 있다**는 것을 알아채고, 유휴 커넥션을 미리 워밍업해 경쟁을 실제로 재현한다. 이건 흔치 않다. `schema.test.ts:16-20`의 `normalizeMillis`도 PG의 후행 0 절삭을 정확히 되돌려, 9시간 밀림 같은 진짜 회귀만 잡고 형식 잡음에는 반응하지 않는다.

- **KST 체인 자체는 일관된다.** `dbNow()` → `toKstTimestamp` → 3자리 밀리초 고정 문자열 → `TIMESTAMP` 컬럼 → 타입 파서 무변환 → 원문 문자열 복귀. 노드 프로세스 타임존에도 컨테이너 타임존에도 의존하지 않고(컨테이너 `TZ`는 미래의 SQL `NOW()`를 위한 보험이다), 왕복이 테스트로 고정돼 있다. `expiresAt` 사전순 비교도 이 형식에서는 시간순과 일치한다(P7에 적은 전제와 커버리지 공백은 별개 문제다).

- **`resetDb()`의 이중 가드**(`testing.ts:7-14`, `env.ts:21-31`)는 태스크 리뷰가 잡은 Critical에 대한 올바른 반응이다. `NODE_ENV`만이 아니라 **실제 접속 문자열**을 검사하고, env 스키마가 폴백 자체를 불가능하게 만든다. 환경변수 하나가 틀렸을 때 개발 데이터가 날아가는 대신 프로세스가 죽는다.

- **Task 7의 원인 규명이 정직했다.** "테스트가 가끔 실패한다"에서 멈추지 않고, 단독 실행 통과 / 전체 실행 실패 / 직접 SQL 프로브로 DB 순서를 배제 / 파일 병렬성으로 원인 확정 / **경쟁이므로 연속 2회 초록**을 수정 수용 조건으로 요구했다. 그리고 "Task 4와 6의 이전 초록은 일부 운이었다"고 기록으로 남겼다. 이 기록이 없었으면 다음 사람이 같은 함정에 다시 빠진다.

- **계획서가 결함을 발견할 때마다 실제로 수정됐다.** 12개 태스크 중 7개에서 결함의 뿌리가 구현이 아니라 계획서였고, 매번 계획 문서가 먼저 고쳐진 뒤 구현이 따라갔다. 2단계가 같은 문서를 상속받으므로 이건 복리로 돌아온다. (그럼에도 `plan:1003`의 "daily_test는 이미 만들어져 있다"처럼 로컬 상태를 저장소 상태로 착각한 문장이 하나 남았다 — B3의 뿌리다.)
