CREATE TABLE "login_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"ip" text NOT NULL,
	"succeeded" text NOT NULL,
	"attempted_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp NOT NULL,
	"created_by" bigint NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" bigint NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" bigint
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"replaced_by" bigint,
	"created_at" timestamp NOT NULL,
	"created_by" bigint NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" bigint NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" bigint
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"deletion_requested_at" timestamp,
	"created_at" timestamp NOT NULL,
	"created_by" bigint NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" bigint NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" bigint
);
--> statement-breakpoint
CREATE INDEX "login_attempts_email_idx" ON "login_attempts" USING btree ("email","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_hash_uq" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_uq" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");