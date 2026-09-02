CREATE TABLE "feedback_events" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigserial NOT NULL,
	"project_id" text,
	"timeline_version" integer,
	"clip_id" text,
	"segment_id" text,
	"moment_id" text,
	"asset_id" text,
	"kind" text NOT NULL,
	"value" real,
	"note" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_events_kind_check" CHECK ("feedback_events"."kind" in ('SWAP_OUT','SWAP_IN','CLIP_UP','CLIP_DOWN','VIDEO_RATING','BAN_MOMENT','UNBAN_MOMENT','BAN_ASSET','UNBAN_ASSET','NOTE','PLACED')),
	CONSTRAINT "feedback_events_source_check" CHECK ("feedback_events"."source" in ('USER','SYSTEM'))
);
--> statement-breakpoint
CREATE TABLE "moment_feedback_embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"feedback_event_id" text NOT NULL,
	"moment_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"polarity" text NOT NULL,
	"source_text" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"model" text NOT NULL,
	"model_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moment_feedback_embeddings_polarity_check" CHECK ("moment_feedback_embeddings"."polarity" in ('POSITIVE','NEGATIVE'))
);
--> statement-breakpoint
ALTER TABLE "segment_matches" ADD COLUMN "feedback_cutoff_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "moment_feedback_embeddings" ADD CONSTRAINT "moment_feedback_embeddings_feedback_event_id_feedback_events_id_fk" FOREIGN KEY ("feedback_event_id") REFERENCES "public"."feedback_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_events_moment_idx" ON "feedback_events" USING btree ("moment_id");--> statement-breakpoint
CREATE INDEX "feedback_events_project_idx" ON "feedback_events" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "feedback_events_kind_idx" ON "feedback_events" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "moment_feedback_embeddings_unique" ON "moment_feedback_embeddings" USING btree ("feedback_event_id","model","model_version");--> statement-breakpoint
CREATE INDEX "moment_feedback_embeddings_moment_idx" ON "moment_feedback_embeddings" USING btree ("moment_id");--> statement-breakpoint
CREATE INDEX "moment_feedback_embeddings_cosine_idx" ON "moment_feedback_embeddings" USING hnsw ("embedding" vector_cosine_ops);