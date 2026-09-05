CREATE TABLE "subtitles" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"language" text NOT NULL,
	"source_language" text,
	"translated" boolean DEFAULT false NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text NOT NULL,
	"model_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subtitles" ADD CONSTRAINT "subtitles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subtitles_project_idx" ON "subtitles" USING btree ("project_id");
