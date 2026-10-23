CREATE TABLE "quota_use" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quota_use_kind" CHECK ("quota_use"."kind" IN ('photo', 'recipe'))
);
--> statement-breakpoint
ALTER TABLE "quota_use" ADD CONSTRAINT "quota_use_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quota_use_member_kind_created_idx" ON "quota_use" USING btree ("member_id","kind","created_at");