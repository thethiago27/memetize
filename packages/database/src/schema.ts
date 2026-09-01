import type {
  AssetStatus,
  AudioSection,
  BeatPoint,
  EmbeddingType,
  EnergyPoint,
  ExtractedFrame,
  FeedbackContext,
  FeedbackKind,
  FeedbackPolarity,
  FeedbackSource,
  HighlightScoreBreakdown,
  JobStatus,
  JobType,
  LyricLine,
  LyricSource,
  NarrativeSourceKind,
  ProjectStatus,
  RankedCandidate,
  RenderValidation,
  ResourceClass,
  RetrievedCandidate,
  ShortlistCandidate,
  TranscriptWord,
  VisionSceneAnalysis,
} from '@memetize/contracts';
import { EMBEDDING_DIMENSIONS } from '@memetize/shared';
import type { Timeline } from '@memetize/timeline';
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

/** A music project (spec sections 39, 41): the timeline the catalog gets matched into. */
export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    filename: text('filename').notNull(),
    status: text('status').$type<ProjectStatus>().notNull().default('CREATED'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'projects_status_check',
      sql`${table.status} in ('CREATED','ANALYZING_AUDIO','PLANNING','TIMELINE_READY','RENDERING','COMPLETED','FAILED')`,
    ),
  ],
);

/**
 * The project's source audio file (spec section 39). No unique checksum: the
 * same mp3 can seed two independent projects (spec section 41 note).
 */
export const projectAudio = pgTable('project_audio', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  originalPath: text('original_path').notNull(),
  // Repo-relative path to a copy of the user-supplied lyrics file, if any
  // (spec section 26); kept so `reprocess --from lyrics` can replay it.
  lyricsPath: text('lyrics_path'),
  checksum: text('checksum').notNull(),
  durationMs: integer('duration_ms').notNull(),
  contentType: text('content_type'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
});

/** Audio Analyzer output (spec section 25). Times are integer ms; BPM/energy are plain numbers. */
export const audioAnalysis = pgTable(
  'audio_analysis',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    durationMs: integer('duration_ms').notNull(),
    bpm: real('bpm').notNull(),
    beats: jsonb('beats').$type<BeatPoint[]>().notNull().default([]),
    downbeats: jsonb('downbeats').$type<number[]>().notNull().default([]),
    sections: jsonb('sections').$type<AudioSection[]>().notNull().default([]),
    energyCurve: jsonb('energy_curve').$type<EnergyPoint[]>().notNull().default([]),
    analyzer: text('analyzer').notNull(),
    analyzerVersion: text('analyzer_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('audio_analysis_unique').on(table.projectId, table.analyzer, table.analyzerVersion),
    index('audio_analysis_project_idx').on(table.projectId),
  ],
);

/** Lyrics Worker output (spec section 26): user-supplied, transcribed, or empty/fixture. */
export const lyrics = pgTable(
  'lyrics',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    source: text('source').$type<LyricSource>().notNull(),
    lines: jsonb('lines').$type<LyricLine[]>().notNull().default([]),
    model: text('model').notNull(),
    modelVersion: text('model_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('lyrics_unique').on(table.projectId, table.source, table.model, table.modelVersion),
    index('lyrics_project_idx').on(table.projectId),
    check('lyrics_source_check', sql`${table.source} in ('USER','TRANSCRIPT','FIXTURE')`),
  ],
);

/** Narrative Analyzer output (spec section 27): editorial reading of lyrics + musical structure. */
export const narrativeSegments = pgTable(
  'narrative_segments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    sourceKind: text('source_kind').$type<NarrativeSourceKind>().notNull().default('LYRIC'),
    lyrics: text('lyrics').notNull(),
    meaning: text('meaning').notNull(),
    emotion: text('emotion').notNull(),
    narrativeFunction: text('narrative_function').notNull(),
    visualIdeas: jsonb('visual_ideas').$type<string[]>().notNull().default([]),
    literalness: real('literalness').notNull(),
    ironyPotential: real('irony_potential').notNull(),
    energy: real('energy').notNull(),
    extractor: text('extractor').notNull(),
    extractorVersion: text('extractor_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('narrative_segments_project_idx').on(table.projectId),
    check(
      'narrative_segments_source_kind_check',
      sql`${table.sourceKind} in ('LYRIC','INSTRUMENTAL')`,
    ),
  ],
);

/**
 * Matching funnel output per narrative segment (spec sections 28-30, 39):
 * the three JSONB columns are successive cuts of the same candidate pool
 * (retrieved -> ranked -> shortlist), kept together so `project inspect`
 * and debugging can see the whole funnel without re-deriving it.
 */
export const segmentMatches = pgTable(
  'segment_matches',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    segmentId: text('segment_id')
      .notNull()
      .references(() => narrativeSegments.id, { onDelete: 'cascade' }),
    retrieved: jsonb('retrieved').$type<RetrievedCandidate[]>().notNull().default([]),
    ranked: jsonb('ranked').$type<RankedCandidate[]>().notNull().default([]),
    shortlist: jsonb('shortlist').$type<ShortlistCandidate[]>().notNull().default([]),
    ranker: text('ranker').notNull(),
    rankerVersion: text('ranker_version').notNull(),
    // Newest feedback event the ranker considered (editorial-memory spec);
    // null before ranker 2.0.0 or when no feedback existed.
    feedbackCutoffAt: timestamp('feedback_cutoff_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('segment_matches_unique').on(
      table.projectId,
      table.segmentId,
      table.ranker,
      table.rankerVersion,
    ),
    index('segment_matches_project_idx').on(table.projectId),
  ],
);

/**
 * Timeline Director output (spec sections 31, 34-35, 39): append-only —
 * `insertTimelineVersion` always inserts the next `version`, never
 * overwrites an existing row, so `project inspect` history and future
 * rollback (spec section 35) both have every version to look at.
 */
export const timelineVersions = pgTable(
  'timeline_versions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    data: jsonb('data').$type<Timeline>().notNull(),
    director: text('director').notNull(),
    directorVersion: text('director_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    // Null for the Director's own raw version; populated only on the version
    // the Timing Optimizer (spec section 32, phase 8) inserts right after it.
    timingOptimizer: text('timing_optimizer'),
    timingOptimizerVersion: text('timing_optimizer_version'),
    // Null until the Effects Planner (spec sections 33, 57, phase 9) writes
    // the version that actually carries `clip.effects`.
    effectsPlanner: text('effects_planner'),
    effectsPlannerVersion: text('effects_planner_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('timeline_versions_unique').on(table.projectId, table.version),
    index('timeline_versions_project_idx').on(table.projectId),
  ],
);

/**
 * Selected source window for a music project: full track when it is at most
 * 60 seconds, otherwise one scored 60,000 ms highlight. Append-only versions.
 */
export const editWindows = pgTable(
  'edit_windows',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    sourceStartMs: integer('source_start_ms').notNull(),
    sourceEndMs: integer('source_end_ms').notNull(),
    durationMs: integer('duration_ms').notNull(),
    targetDurationMs: integer('target_duration_ms').notNull(),
    score: real('score').notNull(),
    scoreBreakdown: jsonb('score_breakdown').$type<HighlightScoreBreakdown>().notNull(),
    selector: text('selector').notNull(),
    selectorVersion: text('selector_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('edit_windows_unique').on(table.projectId, table.version),
    index('edit_windows_project_idx').on(table.projectId),
  ],
);

export const renders = pgTable(
  'renders',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    timelineVersion: integer('timeline_version').notNull(),
    path: text('path').notNull(),
    durationMs: integer('duration_ms').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    fps: integer('fps').notNull(),
    videoCodec: text('video_codec').notNull(),
    audioCodec: text('audio_codec').notNull(),
    renderer: text('renderer').notNull(),
    rendererVersion: text('renderer_version').notNull(),
    validation: jsonb('validation').$type<RenderValidation>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('renders_unique').on(table.projectId, table.version),
    index('renders_project_idx').on(table.projectId),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type ProjectAudioRow = typeof projectAudio.$inferSelect;
export type NewProjectAudioRow = typeof projectAudio.$inferInsert;
export type AudioAnalysisRow = typeof audioAnalysis.$inferSelect;
export type NewAudioAnalysisRow = typeof audioAnalysis.$inferInsert;
export type LyricsRow = typeof lyrics.$inferSelect;
export type NewLyricsRow = typeof lyrics.$inferInsert;
export type NarrativeSegmentRow = typeof narrativeSegments.$inferSelect;
export type NewNarrativeSegmentRow = typeof narrativeSegments.$inferInsert;
export type SegmentMatchRow = typeof segmentMatches.$inferSelect;
export type NewSegmentMatchRow = typeof segmentMatches.$inferInsert;
export type TimelineVersionRow = typeof timelineVersions.$inferSelect;
export type NewTimelineVersionRow = typeof timelineVersions.$inferInsert;
export type RenderRow = typeof renders.$inferSelect;
export type NewRenderRow = typeof renders.$inferInsert;
export type EditWindowRow = typeof editWindows.$inferSelect;
export type NewEditWindowRow = typeof editWindows.$inferInsert;

/**
 * Editorial memory (editorial-memory spec): one append-only row per swap,
 * rating, ban, note, or system placement. Deliberately no foreign keys to
 * projects, moments, or assets — the memory must outlive catalog and
 * project reprocessing, otherwise every lesson would vanish with its source.
 */
export const feedbackEvents = pgTable(
  'feedback_events',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id'),
    timelineVersion: integer('timeline_version'),
    clipId: text('clip_id'),
    segmentId: text('segment_id'),
    momentId: text('moment_id'),
    assetId: text('asset_id'),
    kind: text('kind').$type<FeedbackKind>().notNull(),
    value: real('value'),
    note: text('note'),
    context: jsonb('context').$type<FeedbackContext>().notNull().default({}),
    source: text('source').$type<FeedbackSource>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('feedback_events_moment_idx').on(table.momentId),
    index('feedback_events_project_idx').on(table.projectId),
    index('feedback_events_kind_idx').on(table.kind),
    check(
      'feedback_events_kind_check',
      sql`${table.kind} in ('SWAP_OUT','SWAP_IN','CLIP_UP','CLIP_DOWN','VIDEO_RATING','BAN_MOMENT','UNBAN_MOMENT','BAN_ASSET','UNBAN_ASSET','NOTE','PLACED')`,
    ),
    check('feedback_events_source_check', sql`${table.source} in ('USER','SYSTEM')`),
  ],
);

/**
 * Vectors learned from swaps: the segment text a moment was chosen for
 * (POSITIVE) or rejected from (NEGATIVE). Kept apart from
 * `moment_embeddings` so a catalog re-embed never wipes them.
 */
export const momentFeedbackEmbeddings = pgTable(
  'moment_feedback_embeddings',
  {
    id: text('id').primaryKey(),
    feedbackEventId: text('feedback_event_id')
      .notNull()
      .references(() => feedbackEvents.id, { onDelete: 'cascade' }),
    momentId: text('moment_id').notNull(),
    assetId: text('asset_id').notNull(),
    polarity: text('polarity').$type<FeedbackPolarity>().notNull(),
    sourceText: text('source_text').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    model: text('model').notNull(),
    modelVersion: text('model_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('moment_feedback_embeddings_unique').on(
      table.feedbackEventId,
      table.model,
      table.modelVersion,
    ),
    index('moment_feedback_embeddings_moment_idx').on(table.momentId),
    index('moment_feedback_embeddings_cosine_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
    check(
      'moment_feedback_embeddings_polarity_check',
      sql`${table.polarity} in ('POSITIVE','NEGATIVE')`,
    ),
  ],
);

export type FeedbackEventRow = typeof feedbackEvents.$inferSelect;
export type NewFeedbackEventRow = typeof feedbackEvents.$inferInsert;
export type MomentFeedbackEmbeddingRow = typeof momentFeedbackEmbeddings.$inferSelect;
export type NewMomentFeedbackEmbeddingRow = typeof momentFeedbackEmbeddings.$inferInsert;
