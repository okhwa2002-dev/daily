# Daily — 프로젝트 가이드

지출·운동·식사·일기를 기록하는 일일 기록 서비스. 오프라인 입력을 지원하는 모바일 웹 PWA이며, 불특정 다수를 대상으로 하는 공개 서비스다.

- 프론트: React 19 + Vite + Tailwind v4 + Dexie(IndexedDB)
- 백엔드: Fastify + Drizzle ORM + PostgreSQL 18
- 배포: VPS 직접 운영 (nginx + PM2)

상세 스택과 구조는 [project-structure.md](.claude/roles/project-structure.md) 참고.

---

## 개발 규칙

규칙은 `.claude/roles/` 아래 영역별로 관리한다. 목록은 [.claude/roles/README.md](.claude/roles/README.md) 참고.

@.claude/roles/project-structure.md
@.claude/roles/database.md
@.claude/roles/security.md

---

## 기능 범위

지출, 운동(근력 세트 기록 포함), 식사, 일기(하루 1건), 독서(책 목록 + 감상평 N개), 통계.

## 현재 상태

설계 확정. 1단계(기반·인증) 구현 완료, 2단계(동기화·도메인 기능) 미착수.

설계 문서: [2026-08-06-daily-tracker-design.md](docs/superpowers/specs/2026-08-06-daily-tracker-design.md)

| 항목 | 상태 |
|---|---|
| 설계 (스택·구조·데이터 모델·동기화·인증·에러 처리) | 확정 |
| 모노레포, shared 패키지, Fastify 앱, PWA 셸 | 완료 |
| DB 스키마·마이그레이션 (계정 4 + 도메인 7 테이블) | 완료 |
| 인증 (회원가입·로그인·토큰 로테이션·로그아웃) | 완료 |
| 동기화 엔진 | 미착수 |
| 도메인 API·화면 | 미착수 |
| 계정 복구 (비밀번호 재설정·이메일 인증·탈퇴) | 미착수 (공개 배포 전 필수) |
| 약관·개인정보처리방침 | 미작성 (공개 배포 전 필수) |
