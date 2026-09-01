CREATE TABLE "edit_windows" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"source_start_ms" integer NOT NULL,
	"source_end_ms" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"target_duration_ms" integer NOT NULL,
	"score" real NOT NULL,
	"score_breakdown" jsonb NOT NULL,
	"selector" text NOT NULL,
	"selector_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "edit_windows" ADD CONSTRAINT "edit_windows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "edit_windows_unique" ON "edit_windows" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "edit_windows_project_idx" ON "edit_windows" USING btree ("project_id");