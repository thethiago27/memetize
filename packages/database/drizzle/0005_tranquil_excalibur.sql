CREATE TABLE "timeline_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"director" text NOT NULL,
	"director_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "timeline_versions" ADD CONSTRAINT "timeline_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "timeline_versions_unique" ON "timeline_versions" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "timeline_versions_project_idx" ON "timeline_versions" USING btree ("project_id");