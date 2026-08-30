import type { AssetStatus, JobStatus, JobType, ResourceClass } from '@memetize/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** Local PostgreSQL job queue (spec section 7). */
export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    type: text('type').$type<JobType>().notNull(),
    entityId: text('entity_id').notNull(),
    status: text('status').$type<JobStatus>().notNull().default('PENDING'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb('result').$type<Record<string, unknown>>(),
    priority: integer('priority').notNull().default(0),
    resourceClass: text('resource_class').$type<ResourceClass>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    inputHash: text('input_hash').notNull(),
    workerVersion: text('worker_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
  },
  (table) => [
    // Idempotency key (spec section 4.2): one persisted result per logical run.
    uniqueIndex('jobs_idempotency_key').on(
      table.type,
      table.entityId,
      table.inputHash,
      table.workerVersion,
    ),
    // Supports the claim query: PENDING ordered by priority DESC, created_at.
    index('jobs_claim_idx').on(table.status, table.priority, table.createdAt),
    index('jobs_entity_idx').on(table.entityId),
    check(
      'jobs_status_check',
      sql`${table.status} in ('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED')`,
    ),
  ],
);

/** Catalogued media (spec section 14). */
export const mediaAssets = pgTable(
  'media_assets',
  {
    id: text('id').primaryKey(),
    filename: text('filename').notNull(),
    originalPath: text('original_path').notNull(),
    proxyPath: text('proxy_path'),
    analysisPath: text('analysis_path'),
    thumbnailPath: text('thumbnail_path'),
    checksum: text('checksum').notNull(),
    durationMs: integer('duration_ms'),
    width: integer('width'),
    height: integer('height'),
    fpsMilli: integer('fps_milli'),
    contentType: text('content_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    status: text('status').$type<AssetStatus>().notNull().default('INGESTED'),
    rightsStatus: text('rights_status'),
    source: text('source'),
    copyrightOwner: text('copyright_owner'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('media_assets_checksum_key').on(table.checksum),
    check(
      'media_assets_status_check',
      sql`${table.status} in ('INGESTED','NORMALIZING','ANALYZING','INDEXING','READY','FAILED')`,
    ),
  ],
);

/** Editorial cuts detected per asset (spec section 16). Times are integer ms. */
export const scenes = pgTable(
  'scenes',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    durationMs: integer('duration_ms').notNull(),
    detector: text('detector').notNull(),
    detectorVersion: text('detector_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('scenes_asset_idx').on(table.assetId)],
);

export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
export type MediaAssetRow = typeof mediaAssets.$inferSelect;
export type NewMediaAssetRow = typeof mediaAssets.$inferInsert;
export type SceneRow = typeof scenes.$inferSelect;
export type NewSceneRow = typeof scenes.$inferInsert;
