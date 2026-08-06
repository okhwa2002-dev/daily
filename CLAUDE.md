# Daily — 프로젝트 가이드

지출·운동·식사·일기를 기록하는 일일 기록 서비스. 오프라인 입력을 지원하는 모바일 웹 PWA이며, 불특정 다수를 대상으로 하는 공개 서비스다.

- 프론트: React 19 + Vite + Tailwind v4 + Dexie(IndexedDB)
- 백엔드: Fastify + Drizzle ORM + PostgreSQL 17
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

설계 완료, 구현 미시작.

설계 문서: [2026-08-06-daily-tracker-design.md](docs/superpowers/specs/2026-08-06-daily-tracker-design.md)

| 항목 | 상태 |
|---|---|
| 기술 스택 선정 | 확정 |
| 프로젝트 구조 | 확정 |
| 테이블 규칙·도메인 모델 | 확정 |
| 동기화 프로토콜 | 확정 |
| 인증 흐름 | 확정 |
| 에러 처리·테스트 전략 | 확정 |
| 구현 계획 | 미작성 |
| 약관·개인정보처리방침 | 미작성 (공개 배포 전 필수) |
