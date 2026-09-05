CREATE TABLE "entity_execution" (
	"entity_kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"active_generation_id" text,
	"current_timeline_version" integer DEFAULT 0 NOT NULL,
	"next_render_version" integer DEFAULT 1 NOT NULL,
	"next_timeline_version" integer DEFAULT 1 NOT NULL,
	"next_window_version" integer DEFAULT 1 NOT NULL,
	"constraints_revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_execution_entity_kind_entity_id_pk" PRIMARY KEY("entity_kind","entity_id"),
	CONSTRAINT "entity_execution_kind_check" CHECK ("entity_execution"."entity_kind" in ('project','asset'))
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "lease_token" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "generation_id" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "step_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_generation_step_key" ON "jobs" USING btree ("entity_id","generation_id","step_key") WHERE generation_id is not null and step_key is not null;