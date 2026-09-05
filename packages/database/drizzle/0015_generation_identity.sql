CREATE TABLE "moment_identities" (
	"asset_id" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"moment_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moment_identities_asset_id_start_ms_end_ms_pk" PRIMARY KEY("asset_id","start_ms","end_ms")
);
--> statement-breakpoint
ALTER TABLE "moment_identities" ADD CONSTRAINT "moment_identities_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "moment_identities_moment_id" ON "moment_identities" USING btree ("moment_id");--> statement-breakpoint
ALTER TABLE "entity_execution" DROP COLUMN "constraints_revision";--> statement-breakpoint
-- Upgrade backfill (F08/F09/F12). Deploy with the previous workers stopped: a
-- RUNNING job left over from before leases has no owner, so give it an expired
-- lease here and let the reconciler/claim path recover it instead of leaving it
-- RUNNING forever (a NULL lease never compares as expired).
UPDATE "jobs" SET "lease_expires_at" = clock_timestamp() WHERE "status" = 'RUNNING' AND "lease_expires_at" IS NULL;--> statement-breakpoint
-- Every existing entity gets its coordination row with counters seeded from
-- history, so reserved versions never collide with rows written before F09.
INSERT INTO "entity_execution" ("entity_kind", "entity_id", "current_timeline_version", "next_render_version", "next_timeline_version", "next_window_version")
SELECT 'project', p."id",
  coalesce(t.max_version, 0),
  coalesce(r.max_version, 0) + 1,
  coalesce(t.max_version, 0) + 1,
  coalesce(w.max_version, 0) + 1
FROM "projects" p
LEFT JOIN (SELECT "project_id", max("version") AS max_version FROM "timeline_versions" GROUP BY "project_id") t ON t."project_id" = p."id"
LEFT JOIN (SELECT "project_id", max("version") AS max_version FROM "renders" GROUP BY "project_id") r ON r."project_id" = p."id"
LEFT JOIN (SELECT "project_id", max("version") AS max_version FROM "edit_windows" GROUP BY "project_id") w ON w."project_id" = p."id"
ON CONFLICT ("entity_kind", "entity_id") DO UPDATE SET
  "current_timeline_version" = greatest("entity_execution"."current_timeline_version", excluded."current_timeline_version"),
  "next_render_version" = greatest("entity_execution"."next_render_version", excluded."next_render_version"),
  "next_timeline_version" = greatest("entity_execution"."next_timeline_version", excluded."next_timeline_version"),
  "next_window_version" = greatest("entity_execution"."next_window_version", excluded."next_window_version");--> statement-breakpoint
INSERT INTO "entity_execution" ("entity_kind", "entity_id") SELECT 'asset', "id" FROM "media_assets" ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Existing moments keep their ids across future re-extractions (F12).
INSERT INTO "moment_identities" ("asset_id", "start_ms", "end_ms", "moment_id")
SELECT "asset_id", "start_ms", "end_ms", "id" FROM "moments" ORDER BY "created_at" ASC
ON CONFLICT DO NOTHING;
