# 배포

## 사전 준비

- Node 22 LTS, pnpm, PostgreSQL 18, nginx, certbot, PM2
- `daily` 데이터베이스 생성
- 서버에 `.env` 작성 (`.env.example` 참고). **저장소에 커밋하지 않는다.**

## 배포 절차

```bash
git pull
pnpm install --frozen-lockfile

# 1. 마이그레이션 (앱 재시작 전에 실행)
pnpm --filter @daily/api db:migrate

# 2. 프론트 빌드 후 릴리스 디렉터리에 배치
pnpm --filter @daily/web build
RELEASE=/var/www/daily/releases/$(date +%Y%m%d%H%M%S)
mkdir -p "$RELEASE"
cp -r apps/web/dist/* "$RELEASE"
ln -sfn "$RELEASE" /var/www/daily/current

# 3. API 재시작
pm2 reload apps/api/ecosystem.config.cjs
```

## 롤백

```bash
ln -sfn /var/www/daily/releases/<이전_타임스탬프> /var/www/daily/current
pm2 reload daily-api
```

프론트는 심볼릭 링크만 되돌리면 즉시 롤백된다. DB 마이그레이션은 되돌아가지 않으므로,
**컬럼 삭제·타입 변경은 배포 두 번에 나눠서 한다** (먼저 새 컬럼 추가 후 코드 전환, 다음 배포에서 옛 컬럼 제거).

## 백업

`crontab -e`:

```
0 4 * * * pg_dump daily | gzip > /var/backups/daily/daily-$(date +\%Y\%m\%d).sql.gz
0 5 * * * find /var/backups/daily -name '*.sql.gz' -mtime +7 -delete
```

복구 절차를 실제로 한 번 시험해본다. 시험하지 않은 백업은 백업이 아니다.

## 모니터링

- `pm2 logs daily-api` — 애플리케이션 로그
- `pm2 monit` — 메모리·CPU
- `/api/health` — 헬스체크 엔드포인트
