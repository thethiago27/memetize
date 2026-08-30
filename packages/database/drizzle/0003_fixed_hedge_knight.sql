CREATE TABLE "audio_analysis" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"bpm" real NOT NULL,
	"beats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"downbeats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"energy_curve" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"analyzer" text NOT NULL,
	"analyzer_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lyrics" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source" text NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text NOT NULL,
	"model_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lyrics_source_check" CHECK ("lyrics"."source" in ('USER','TRANSCRIPT','FIXTURE'))
);
--> statement-breakpoint
CREATE TABLE "narrative_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"lyrics" text NOT NULL,
	"meaning" text NOT NULL,
	"emotion" text NOT NULL,
	"narrative_function" text NOT NULL,
	"visual_ideas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"literalness" real NOT NULL,
	"irony_potential" real NOT NULL,
	"energy" real NOT NULL,
	"extractor" text NOT NULL,
	"extractor_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_audio" (
	"project_id" text PRIMARY KEY NOT NULL,
	"original_path" text NOT NULL,
	"lyrics_path" text,
	"checksum" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"content_type" text,
	"size_bytes" bigint
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"status" text DEFAULT 'CREATED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_status_check" CHECK ("projects"."status" in ('CREATED','ANALYZING_AUDIO','PLANNING','TIMELINE_READY','RENDERING','COMPLETED','FAILED'))
);
--> statement-breakpoint
ALTER TABLE "audio_analysis" ADD CONSTRAINT "audio_analysis_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lyrics" ADD CONSTRAINT "lyrics_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_segments" ADD CONSTRAINT "narrative_segments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_audio" ADD CONSTRAINT "project_audio_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audio_analysis_unique" ON "audio_analysis" USING btree ("project_id","analyzer","analyzer_version");--> statement-breakpoint
CREATE INDEX "audio_analysis_project_idx" ON "audio_analysis" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lyrics_unique" ON "lyrics" USING btree ("project_id","source","model","model_version");--> statement-breakpoint
CREATE INDEX "lyrics_project_idx" ON "lyrics" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "narrative_segments_project_idx" ON "narrative_segments" USING btree ("project_id");