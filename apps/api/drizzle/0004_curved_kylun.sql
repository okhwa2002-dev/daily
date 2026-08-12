CREATE TABLE "code_groups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"created_by" bigint NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" bigint NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" bigint
);
--> statement-breakpoint
CREATE TABLE "codes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_code" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp NOT NULL,
	"created_by" bigint NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" bigint NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" bigint
);
--> statement-breakpoint
-- FK가 참조하는 group_code는 PK가 아니라 별도 유니크 인덱스로만 유일성을 갖는다.
-- Postgres는 FK 대상 컬럼에 유니크 제약/인덱스가 이미 있어야 하므로, drizzle-kit이
-- 낸 원래 순서(ALTER TABLE 먼저, CREATE UNIQUE INDEX 나중)로 실행하면
-- "there is no unique constraint matching given keys" 에러로 막힌다. 인덱스
-- 생성을 FK 제약보다 앞으로 옮겼다 — 내용은 drizzle-kit이 낸 그대로다.
CREATE UNIQUE INDEX "code_groups_group_code_uq" ON "code_groups" USING btree ("group_code");--> statement-breakpoint
ALTER TABLE "codes" ADD CONSTRAINT "codes_group_code_code_groups_group_code_fk" FOREIGN KEY ("group_code") REFERENCES "public"."code_groups"("group_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "codes_group_code_uq" ON "codes" USING btree ("group_code","code");--> statement-breakpoint
CREATE INDEX "codes_group_sort_idx" ON "codes" USING btree ("group_code","sort_order");
--> statement-breakpoint
INSERT INTO "code_groups"
  ("group_code", "name", "created_at", "created_by", "updated_at", "updated_by")
VALUES ('BOOK_GENRE', '독서 장르', NOW(), 0, NOW(), 0)
ON CONFLICT ("group_code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "codes"
  ("group_code", "code", "name", "sort_order",
   "created_at", "created_by", "updated_at", "updated_by")
VALUES
  ('BOOK_GENRE', 'NOVEL',      '소설',   1, NOW(), 0, NOW(), 0),
  ('BOOK_GENRE', 'ESSAY',      '에세이', 2, NOW(), 0, NOW(), 0),
  ('BOOK_GENRE', 'HUMANITIES', '인문',   3, NOW(), 0, NOW(), 0),
  ('BOOK_GENRE', 'SCIENCE',    '과학',   4, NOW(), 0, NOW(), 0),
  ('BOOK_GENRE', 'TECH',       '기술',   5, NOW(), 0, NOW(), 0),
  ('BOOK_GENRE', 'ECONOMY',    '경제',   6, NOW(), 0, NOW(), 0),
  ('BOOK_GENRE', 'ETC',        '기타',   7, NOW(), 0, NOW(), 0)
ON CONFLICT ("group_code", "code") DO NOTHING;