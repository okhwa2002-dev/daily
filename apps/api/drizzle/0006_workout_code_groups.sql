-- 부위·강도를 공통코드로 옮긴다. 값 집합이 런타임 데이터가 되므로 CHECK로
-- 표현할 수 없다 — 서버가 sync 검증 단계에서 codes와 대조한다 (registry.ts).
-- IF EXISTS를 붙여 멱등하게 만든다. 아래 시드도 ON CONFLICT DO NOTHING이다.
ALTER TABLE "workouts" DROP CONSTRAINT IF EXISTS "workouts_body_part_ck";--> statement-breakpoint
ALTER TABLE "workouts" DROP CONSTRAINT IF EXISTS "workouts_intensity_ck";--> statement-breakpoint

-- 시드는 옮기기 전 codes.ts의 BODY_PART·INTENSITY 값·순서와 pages/workout의
-- 한글 라벨을 그대로 옮긴 것이다. 이 마이그레이션만으로 화면이 달라지면 안 된다.
INSERT INTO "code_groups"
  ("group_code", "name", "created_at", "created_by", "updated_at", "updated_by")
VALUES
  ('BODY_PART', '운동 부위', NOW(), 0, NOW(), 0),
  ('INTENSITY', '운동 강도', NOW(), 0, NOW(), 0)
ON CONFLICT ("group_code") DO NOTHING;--> statement-breakpoint

INSERT INTO "codes"
  ("group_code", "code", "name", "sort_order",
   "created_at", "created_by", "updated_at", "updated_by")
VALUES
  ('BODY_PART', 'CHEST',     '가슴',   1, NOW(), 0, NOW(), 0),
  ('BODY_PART', 'BACK',      '등',     2, NOW(), 0, NOW(), 0),
  ('BODY_PART', 'LEGS',      '하체',   3, NOW(), 0, NOW(), 0),
  ('BODY_PART', 'SHOULDERS', '어깨',   4, NOW(), 0, NOW(), 0),
  ('BODY_PART', 'ARMS',      '팔',     5, NOW(), 0, NOW(), 0),
  ('BODY_PART', 'CORE',      '코어',   6, NOW(), 0, NOW(), 0),
  ('BODY_PART', 'FULL_BODY', '전신',   7, NOW(), 0, NOW(), 0),
  ('INTENSITY', 'LOW',       '가볍게', 1, NOW(), 0, NOW(), 0),
  ('INTENSITY', 'MID',       '보통',   2, NOW(), 0, NOW(), 0),
  ('INTENSITY', 'HIGH',      '힘들게', 3, NOW(), 0, NOW(), 0)
ON CONFLICT ("group_code", "code") DO NOTHING;
