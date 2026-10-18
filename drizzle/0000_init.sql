CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('inappropriate_photo', 'plagiarism', 'spam', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TABLE "follow" (
	"follower_id" uuid NOT NULL,
	"followee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_follower_id_followee_id_pk" PRIMARY KEY("follower_id","followee_id"),
	CONSTRAINT "follow_not_self" CHECK ("follow"."follower_id" <> "follow"."followee_id")
);
--> statement-breakpoint
CREATE TABLE "ingredient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"abv_percent" numeric(4, 1) NOT NULL,
	"is_base_spirit" boolean DEFAULT false NOT NULL,
	"is_alcoholic" boolean GENERATED ALWAYS AS (abv_percent > 0) STORED NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredient_name_unique" UNIQUE("name"),
	CONSTRAINT "ingredient_name_not_blank" CHECK (char_length(btrim("ingredient"."name")) > 0),
	CONSTRAINT "ingredient_abv_range" CHECK ("ingredient"."abv_percent" BETWEEN 0 AND 100),
	CONSTRAINT "ingredient_base_is_alcoholic" CHECK (NOT "ingredient"."is_base_spirit" OR "ingredient"."abv_percent" > 0)
);
--> statement-breakpoint
CREATE TABLE "like" (
	"member_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "like_member_id_recipe_id_pk" PRIMARY KEY("member_id","recipe_id")
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"username" text,
	"bio" text,
	"icon_key" text,
	"is_administrator" boolean DEFAULT false NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_username_unique" UNIQUE("username"),
	CONSTRAINT "member_provider_account_unique" UNIQUE("provider","provider_account_id"),
	CONSTRAINT "member_username_format" CHECK ("member"."username" ~ '^[A-Za-z0-9_]{3,20}$'),
	CONSTRAINT "member_bio_length" CHECK (char_length("member"."bio") <= 200)
);
--> statement-breakpoint
CREATE TABLE "recipe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"main_photo_key" text NOT NULL,
	"auto_abv" numeric(4, 1) DEFAULT 0 NOT NULL,
	"abv_override" numeric(4, 1),
	"has_alcohol" boolean DEFAULT false NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_title_length" CHECK (char_length("recipe"."title") BETWEEN 1 AND 50),
	CONSTRAINT "recipe_description_length" CHECK (char_length("recipe"."description") <= 500),
	CONSTRAINT "recipe_auto_abv_range" CHECK ("recipe"."auto_abv" BETWEEN 0 AND 100),
	CONSTRAINT "recipe_non_alcoholic_zero" CHECK ("recipe"."has_alcohol" OR "recipe"."auto_abv" = 0),
	CONSTRAINT "recipe_abv_override_range" CHECK ("recipe"."abv_override" IS NULL OR ("recipe"."has_alcohol" AND "recipe"."abv_override" > 0 AND "recipe"."abv_override" <= 100))
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredient" (
	"recipe_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"mix_ratio" numeric(3, 1) NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "recipe_ingredient_recipe_id_ingredient_id_pk" PRIMARY KEY("recipe_id","ingredient_id"),
	CONSTRAINT "recipe_ingredient_position_unique" UNIQUE("recipe_id","position"),
	CONSTRAINT "recipe_ingredient_mix_ratio_range" CHECK ("recipe_ingredient"."mix_ratio" BETWEEN 0.1 AND 99.9),
	CONSTRAINT "recipe_ingredient_position_range" CHECK ("recipe_ingredient"."position" BETWEEN 1 AND 20)
);
--> statement-breakpoint
CREATE TABLE "recipe_photo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"photo_key" text NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "recipe_photo_position_unique" UNIQUE("recipe_id","position"),
	CONSTRAINT "recipe_photo_position_range" CHECK ("recipe_photo"."position" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "recipe_step" (
	"recipe_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "recipe_step_recipe_id_position_pk" PRIMARY KEY("recipe_id","position"),
	CONSTRAINT "recipe_step_position_range" CHECK ("recipe_step"."position" BETWEEN 1 AND 10),
	CONSTRAINT "recipe_step_text_length" CHECK (char_length("recipe_step"."text") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid,
	"reporter_id" uuid,
	"reason" "report_reason" NOT NULL,
	"detail" text,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_reporter_recipe_unique" UNIQUE("reporter_id","recipe_id"),
	CONSTRAINT "report_detail_length" CHECK (char_length("report"."detail") <= 200)
);
--> statement-breakpoint
CREATE TABLE "save" (
	"member_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "save_member_id_recipe_id_pk" PRIMARY KEY("member_id","recipe_id")
);
--> statement-breakpoint
ALTER TABLE "follow" ADD CONSTRAINT "follow_follower_id_member_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow" ADD CONSTRAINT "follow_followee_id_member_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient" ADD CONSTRAINT "ingredient_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "like" ADD CONSTRAINT "like_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "like" ADD CONSTRAINT "like_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_ingredient_id_ingredient_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredient"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_photo" ADD CONSTRAINT "recipe_photo_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_step" ADD CONSTRAINT "recipe_step_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report" ADD CONSTRAINT "report_reporter_id_member_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."member"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "save" ADD CONSTRAINT "save_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "save" ADD CONSTRAINT "save_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "follow_followee_id_idx" ON "follow" USING btree ("followee_id");--> statement-breakpoint
CREATE INDEX "like_recipe_id_idx" ON "like" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_member_id_idx" ON "recipe" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "recipe_created_at_idx" ON "recipe" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "recipe_search_text_trgm_idx" ON "recipe" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "recipe_ingredient_ingredient_id_idx" ON "recipe_ingredient" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "report_status_idx" ON "report" USING btree ("status");--> statement-breakpoint
CREATE INDEX "save_recipe_id_idx" ON "save" USING btree ("recipe_id");