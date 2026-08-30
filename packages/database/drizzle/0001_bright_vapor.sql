CREATE TABLE "moments" (
	"id" text PRIMARY KEY NOT NULL,
	"scene_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"description" text NOT NULL,
	"primary_emotion" text,
	"emotion_intensity" real,
	"visual_energy" real,
	"quality_score" real,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extractor" text NOT NULL,
	"extractor_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transcript_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"text" text NOT NULL,
	"words" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text NOT NULL,
	"model_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "frames" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "vision" jsonb;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "vision_model" text;--> statement-breakpoint
ALTER TABLE "scenes" ADD COLUMN "vision_version" text;--> statement-breakpoint
ALTER TABLE "moments" ADD CONSTRAINT "moments_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moments" ADD CONSTRAINT "moments_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moments_asset_idx" ON "moments" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "moments_scene_idx" ON "moments" USING btree ("scene_id");--> statement-breakpoint
CREATE INDEX "transcript_segments_asset_idx" ON "transcript_segments" USING btree ("asset_id");