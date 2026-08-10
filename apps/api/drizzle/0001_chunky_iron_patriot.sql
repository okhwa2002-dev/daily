CREATE TABLE "book_notes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"client_uuid" uuid NOT NULL,
	"user_id" bigint NOT NULL,
	"synced_at" timestamp NOT NULL,
	"occurred_on" date NOT NULL,
	"book_id" bigint NOT NULL,
	"book_client_uuid" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"created_by" bigint NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" bigint NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" bigint
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"client_uuid" uuid NOT NULL,
	"user_id" bigint NOT NULL,
	"synced_at" timestamp NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"summary" text,
	"status" text NOT NULL,
	"started_on" date,
	"finished_on" date,
	"created_at" timestamp NOT NULL,
	"created_by" bigint NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" bigint NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" bigint,
	CONSTRAINT "books_status_ck" CHECK ("books"."status" IN ('READING', 'DONE', 'WISHLIST')),
	CONSTRAINT "books_period_ck" CHECK (
    "books"."finished_on" IS NULL OR "books"."started_on" IS NULL
    OR "books"."finished_on" >= "books"."started_on")
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"client_uuid" uuid NOT NULL,
	"user_id" bigint NOT NULL,
	"synced_at" timestamp NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"created_by" bigint NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" bigint NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" bigint
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"client_uuid" uuid NOT NULL,
	"user_id" bigint NOT NULL,
	"synced_at" timestamp NOT NULL,
	"occurred_on" date NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"category_id" bigint,
	"category_client_uuid" uuid,
	"memo" text,
	"created_at" timestamp NOT NULL,
	"created_by" bigint NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" bigint NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" bigint,
	CONSTRAINT "expenses_kind_ck" CHECK ("expenses"."kind" IN ('INCOME', 'EXPENSE')),
	CONSTRAINT "expenses_amount_ck" CHECK ("expenses"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "journals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"client_uuid" uuid NOT NULL,
	"user_id" bigint NOT NULL,
	"synced_at" timestamp NOT NULL,
	"occurred_on" date NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"created_by" bigint NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" bigint NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" bigint
);
--> statement-breakpoint
CREATE TABLE "meals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"client_uuid" uuid NOT NULL,
	"user_id" bigint NOT NULL,
	"synced_at" timestamp NOT NULL,
	"occurred_on" date NOT NULL,
	"slot" text NOT NULL,
	"description" text NOT NULL,
	"portion" text NOT NULL,
	"calories" integer,
	"created_at" timestamp NOT NULL,
	"created_by" bigint NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" bigint NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" bigint,
	CONSTRAINT "meals_slot_ck" CHECK ("meals"."slot" IN ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK')),
	CONSTRAINT "meals_portion_ck" CHECK ("meals"."portion" IN ('LIGHT', 'NORMAL', 'HEAVY')),
	CONSTRAINT "meals_calories_ck" CHECK ("meals"."calories" IS NULL OR "meals"."calories" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"client_uuid" uuid NOT NULL,
	"user_id" bigint NOT NULL,
	"synced_at" timestamp NOT NULL,
	"occurred_on" date NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"body_part" text,
	"sets" jsonb,
	"duration_min" integer,
	"intensity" text,
	"memo" text,
	"created_at" timestamp NOT NULL,
	"created_by" bigint NOT NULL,
	"updated_at" timestamp NOT NULL,
	"updated_by" bigint NOT NULL,
	"deleted_at" timestamp,
	"deleted_by" bigint,
	CONSTRAINT "workouts_kind_ck" CHECK ("workouts"."kind" IN ('STRENGTH', 'CARDIO', 'ETC')),
	CONSTRAINT "workouts_body_part_ck" CHECK ("workouts"."body_part" IS NULL OR "workouts"."body_part" IN ('CHEST', 'BACK', 'LEGS', 'SHOULDERS', 'ARMS', 'CORE', 'FULL_BODY')),
	CONSTRAINT "workouts_intensity_ck" CHECK ("workouts"."intensity" IS NULL OR "workouts"."intensity" IN ('LOW', 'MID', 'HIGH')),
	CONSTRAINT "workouts_duration_ck" CHECK ("workouts"."duration_min" IS NULL OR "workouts"."duration_min" > 0),
	CONSTRAINT "workouts_shape_ck" CHECK (
    ("workouts"."kind" = 'STRENGTH' AND "workouts"."sets" IS NOT NULL AND "workouts"."duration_min" IS NULL)
    OR ("workouts"."kind" = 'CARDIO' AND "workouts"."duration_min" IS NOT NULL AND "workouts"."sets" IS NULL)
    OR "workouts"."kind" = 'ETC')
);
--> statement-breakpoint
ALTER TABLE "book_notes" ADD CONSTRAINT "book_notes_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "book_notes_client_uuid_uq" ON "book_notes" USING btree ("user_id","client_uuid");--> statement-breakpoint
CREATE INDEX "book_notes_occurred_idx" ON "book_notes" USING btree ("user_id","occurred_on");--> statement-breakpoint
CREATE INDEX "book_notes_book_idx" ON "book_notes" USING btree ("user_id","book_id");--> statement-breakpoint
CREATE INDEX "book_notes_pull_idx" ON "book_notes" USING btree ("user_id","synced_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "books_client_uuid_uq" ON "books" USING btree ("user_id","client_uuid");--> statement-breakpoint
CREATE INDEX "books_status_idx" ON "books" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "books_pull_idx" ON "books" USING btree ("user_id","synced_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_client_uuid_uq" ON "expense_categories" USING btree ("user_id","client_uuid");--> statement-breakpoint
CREATE INDEX "expense_categories_pull_idx" ON "expense_categories" USING btree ("user_id","synced_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_client_uuid_uq" ON "expenses" USING btree ("user_id","client_uuid");--> statement-breakpoint
CREATE INDEX "expenses_occurred_idx" ON "expenses" USING btree ("user_id","occurred_on");--> statement-breakpoint
CREATE INDEX "expenses_pull_idx" ON "expenses" USING btree ("user_id","synced_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "journals_client_uuid_uq" ON "journals" USING btree ("user_id","client_uuid");--> statement-breakpoint
CREATE UNIQUE INDEX "journals_day_uq" ON "journals" USING btree ("user_id","occurred_on") WHERE "journals"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "journals_pull_idx" ON "journals" USING btree ("user_id","synced_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "meals_client_uuid_uq" ON "meals" USING btree ("user_id","client_uuid");--> statement-breakpoint
CREATE INDEX "meals_occurred_idx" ON "meals" USING btree ("user_id","occurred_on");--> statement-breakpoint
CREATE INDEX "meals_pull_idx" ON "meals" USING btree ("user_id","synced_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "workouts_client_uuid_uq" ON "workouts" USING btree ("user_id","client_uuid");--> statement-breakpoint
CREATE INDEX "workouts_occurred_idx" ON "workouts" USING btree ("user_id","occurred_on");--> statement-breakpoint
CREATE INDEX "workouts_pull_idx" ON "workouts" USING btree ("user_id","synced_at","id");