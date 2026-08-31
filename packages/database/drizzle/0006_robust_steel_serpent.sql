CREATE TABLE "renders" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"timeline_version" integer NOT NULL,
	"path" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"fps" integer NOT NULL,
	"video_codec" text NOT NULL,
	"audio_codec" text NOT NULL,
	"renderer" text NOT NULL,
	"renderer_version" text NOT NULL,
	"validation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "renders" ADD CONSTRAINT "renders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "renders_unique" ON "renders" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "renders_project_idx" ON "renders" USING btree ("project_id");