# 배포

## 최초 설치 (서버당 한 번)

```bash
# 1. 패키지
#    Node 22 LTS, pnpm, PostgreSQL 18, nginx, certbot, PM2 설치

# 방화벽 — API 포트(3001)는 절대 외부에 열지 않는다. nginx만 루프백으로 붙는다.
sudo ufw allow 22,80,443/tcp
sudo ufw enable

# 2. 저장소와 데이터베이스
git clone <저장소 URL> /srv/daily
cd /srv/daily
createdb daily

# 3. 환경변수 — .env.example을 참고해 작성한다. 저장소에 커밋하지 않는다.
cp .env.example .env && $EDITOR .env

# 4. 릴리스·백업 디렉터리
sudo mkdir -p /var/www/daily/releases /var/backups/daily

# 5. nginx + TLS
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/daily
sudo $EDITOR /etc/nginx/sites-available/daily        # example.com을 실제 도메인으로
sudo ln -s /etc/nginx/sites-available/daily /etc/nginx/sites-enabled/daily
sudo certbot --nginx -d <도메인>
sudo nginx -t && sudo systemctl reload nginx

# 6. API 프로세스 등록 — reload는 이미 등록된 프로세스에만 동작하므로
#    첫 기동은 start여야 한다. save로 재부팅 후 자동 복구까지 걸어둔다.
pnpm install --frozen-lockfile
pnpm --filter @daily/api db:migrate
pm2 start apps/api/ecosystem.config.cjs
pm2 save
pm2 startup                                          # 출력된 명령을 그대로 실행
```

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

배포 직전 커밋 해시를 반드시 기록해둔다. `git log --oneline -1`을 배포 로그에 남기는 것으로 충분하다.

```bash
# 1. 프론트 — 심볼릭 링크만 되돌리면 즉시 반영된다
ln -sfn /var/www/daily/releases/<이전_타임스탬프> /var/www/daily/current

# 2. API — 소스를 되돌리지 않으면 롤백이 아니다
git checkout <이전_커밋_해시>
pnpm install --frozen-lockfile
pm2 reload daily-api
```

**2번을 빠뜨리면 API는 롤백되지 않는다.** PM2는 `tsx`로 작업 트리의 소스를 직접 실행하므로, 프론트처럼 릴리스별 스냅샷이 없다. `git pull`이 이미 끝난 상태에서 `pm2 reload`만 하면 방금 문제를 일으킨 코드를 그대로 다시 띄우는 것이고, 운영자는 롤백했다고 착각하게 된다.

의존성이 버전 간에 달라졌을 수 있으므로 `pnpm install --frozen-lockfile`도 함께 돌린다.

DB 마이그레이션은 되돌아가지 않는다. 그래서 **컬럼 삭제·타입 변경은 배포 두 번에 나눠서 한다** — 먼저 새 컬럼 추가 후 코드 전환, 다음 배포에서 옛 컬럼 제거. 이 규율을 지키는 동안에는 마이그레이션이 항상 이전 버전 코드와 호환되므로, 소스만 되돌리면 롤백이 성립한다.

## 백업

대상 디렉터리는 "최초 설치" 4단계에서 만든다. **셸 리다이렉션은 디렉터리를 만들어주지 않으므로**, 없으면 첫 cron이 조용히 실패하고 아무도 모르는 채 백업이 존재하지 않게 된다.

```bash
sudo mkdir -p /var/backups/daily    # 최초 설치에서 이미 했다면 생략
```

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
