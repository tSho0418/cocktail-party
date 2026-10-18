CREATE TABLE "photo_upload" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_upload_kind" CHECK ("photo_upload"."kind" IN ('recipe', 'member'))
);
--> statement-breakpoint
ALTER TABLE "photo_upload" ADD CONSTRAINT "photo_upload_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photo_upload_member_id_idx" ON "photo_upload" USING btree ("member_id");