CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"entity_id" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"priority" integer DEFAULT 0 NOT NULL,
	"resource_class" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"input_hash" text NOT NULL,
	"worker_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"original_path" text NOT NULL,
	"proxy_path" text,
	"analysis_path" text,
	"thumbnail_path" text,
	"checksum" text NOT NULL,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"fps_milli" integer,
	"content_type" text,
	"size_bytes" bigint,
	"status" text DEFAULT 'INGESTED' NOT NULL,
	"rights_status" text,
	"source" text,
	"copyright_owner" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_status_check" CHECK ("media_assets"."status" in ('INGESTED','NORMALIZING','ANALYZING','INDEXING','READY','FAILED'))
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"detector" text NOT NULL,
	"detector_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_key" ON "jobs" USING btree ("type","entity_id","input_hash","worker_version");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","priority","created_at");--> statement-breakpoint
CREATE INDEX "jobs_entity_idx" ON "jobs" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_checksum_key" ON "media_assets" USING btree ("checksum");--> statement-breakpoint
CREATE INDEX "scenes_asset_idx" ON "scenes" USING btree ("asset_id");