import type {
  AssetStatus,
  EmbeddingType,
  ExtractedFrame,
  JobStatus,
  JobType,
  ResourceClass,
  TranscriptWord,
  VisionSceneAnalysis,
} from '@memetize/contracts';
import { EMBEDDING_DIMENSIONS } from '@memetize/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  vector,
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
    // Frame Extractor output (spec section 18): sampled frame paths, no separate table.
    frames: jsonb('frames').$type<ExtractedFrame[]>().notNull().default([]),
    // Vision Analyzer output (spec section 19). Volatile/structured metadata as JSONB.
    vision: jsonb('vision').$type<VisionSceneAnalysis | null>(),
    visionModel: text('vision_model'),
    visionVersion: text('vision_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('scenes_asset_idx').on(table.assetId)],
);

/** Transcript Worker output (spec section 17). Times are integer ms. */
export const transcriptSegments = pgTable(
  'transcript_segments',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    text: text('text').notNull(),
    words: jsonb('words').$type<TranscriptWord[]>().notNull().default([]),
    model: text('model').notNull(),
    modelVersion: text('model_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('transcript_segments_asset_idx').on(table.assetId)],
);

/** Editorial units extracted from a scene (spec section 21). Times are integer ms. */
export const moments = pgTable(
  'moments',
  {
    id: text('id').primaryKey(),
    sceneId: text('scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    durationMs: integer('duration_ms').notNull(),
    description: text('description').notNull(),
    primaryEmotion: text('primary_emotion'),
    emotionIntensity: real('emotion_intensity'),
    visualEnergy: real('visual_energy'),
    qualityScore: real('quality_score'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    extractor: text('extractor').notNull(),
    extractorVersion: text('extractor_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('moments_asset_idx').on(table.assetId),
    index('moments_scene_idx').on(table.sceneId),
  ],
);

/**
 * Per-moment vectors used by the Candidate Retriever (spec sections 23, 28).
 * `assetId` is denormalized (also reachable via `momentId`) so replace-by-run
 * can target `(assetId, model, modelVersion)` directly, mirroring `moments`.
 */
export const momentEmbeddings = pgTable(
  'moment_embeddings',
  {
    id: text('id').primaryKey(),
    momentId: text('moment_id')
      .notNull()
      .references(() => moments.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    embeddingType: text('embedding_type').$type<EmbeddingType>().notNull(),
    // Kept for debugging (spec section 64): the exact text that was embedded.
    sourceText: text('source_text').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    model: text('model').notNull(),
    modelVersion: text('model_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('moment_embeddings_unique').on(
      table.momentId,
      table.embeddingType,
      table.model,
      table.modelVersion,
    ),
    index('moment_embeddings_asset_idx').on(table.assetId),
    index('moment_embeddings_cosine_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
    check(
      'moment_embeddings_type_check',
      sql`${table.embeddingType} in ('VISUAL','MEME','NARRATIVE')`,
    ),
  ],
);

export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;
export type MediaAssetRow = typeof mediaAssets.$inferSelect;
export type NewMediaAssetRow = typeof mediaAssets.$inferInsert;
export type SceneRow = typeof scenes.$inferSelect;
export type NewSceneRow = typeof scenes.$inferInsert;
export type TranscriptSegmentRow = typeof transcriptSegments.$inferSelect;
export type NewTranscriptSegmentRow = typeof transcriptSegments.$inferInsert;
export type MomentRow = typeof moments.$inferSelect;
export type NewMomentRow = typeof moments.$inferInsert;
export type MomentEmbeddingRow = typeof momentEmbeddings.$inferSelect;
export type NewMomentEmbeddingRow = typeof momentEmbeddings.$inferInsert;
