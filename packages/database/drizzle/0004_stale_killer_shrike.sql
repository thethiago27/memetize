CREATE TABLE "segment_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"retrieved" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ranked" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shortlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ranker" text NOT NULL,
	"ranker_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "segment_matches" ADD CONSTRAINT "segment_matches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_matches" ADD CONSTRAINT "segment_matches_segment_id_narrative_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."narrative_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "segment_matches_unique" ON "segment_matches" USING btree ("project_id","segment_id","ranker","ranker_version");--> statement-breakpoint
CREATE INDEX "segment_matches_project_idx" ON "segment_matches" USING btree ("project_id");