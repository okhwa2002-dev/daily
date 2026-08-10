ALTER TABLE "login_attempts" ADD COLUMN "login_id" text;--> statement-breakpoint
UPDATE "login_attempts" SET "login_id" = "email" WHERE "login_id" IS NULL;--> statement-breakpoint
ALTER TABLE "login_attempts" ALTER COLUMN "login_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "login_id" text;--> statement-breakpoint
UPDATE "users" SET "login_id" = 'user' || "id" WHERE "login_id" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "login_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "login_attempts_login_id_idx" ON "login_attempts" USING btree ("login_id","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_login_id_uq" ON "users" USING btree ("login_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_login_id_ck" CHECK ("users"."login_id" ~ '^[a-z0-9_]{4,20}$');
