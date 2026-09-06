import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { ResourceClass } from '@memetize/contracts';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/** Walks up from `start` to the monorepo root (marked by pnpm-workspace.yaml). */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = start;
  while (true) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

const repoRoot = findRepoRoot();
// Load the root .env regardless of the current working directory (workers and
// scripts run from various cwds).
loadDotenv({ path: resolve(repoRoot, '.env') });

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().optional(),
  STORAGE_PATH: z.string().default('./storage'),
  /** HTTP port for the API process. */
  API_PORT: z.coerce.number().int().positive().default(8787),
  /** How often the API reconciles abandoned jobs and drains what is runnable (F08). */
  JOB_MAINTENANCE_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  MAX_CPU_LIGHT_WORKERS: z.coerce.number().int().positive().default(4),
  MAX_CPU_HEAVY_WORKERS: z.coerce.number().int().positive().default(1),
  MAX_GPU_WORKERS: z.coerce.number().int().positive().default(1),
  MAX_IO_WORKERS: z.coerce.number().int().positive().default(4),
  MAX_RENDER_WORKERS: z.coerce.number().int().positive().default(1),
  TRANSCRIPTION_PROVIDER: z.string().optional(),
  TRANSCRIPTION_MODEL: z.string().optional(),
  VISION_PROVIDER: z.string().optional(),
  VISION_MODEL: z.string().optional(),
  LLM_PROVIDER: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  // Per-stage overrides for the gateway LLM; each falls back to LLM_MODEL.
  LLM_MOMENTS_MODEL: z.string().optional(),
  LLM_NARRATIVE_MODEL: z.string().optional(),
  LLM_DIRECTOR_MODEL: z.string().optional(),
  LLM_SUBTITLES_MODEL: z.string().optional(),
  // Optional; required at runtime when LLM_PROVIDER=gateway. The AI SDK also reads this from the env.
  AI_GATEWAY_API_KEY: z.string().optional(),
  EMBEDDING_PROVIDER: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  AUDIO_PROVIDER: z.string().optional(),
  AUDIO_MODEL: z.string().optional(),
  // Provider mode (F01): 'demo' allows fixture providers; 'production' requires
  // every model-provider capability to be a real (non-fixture) implementation.
  PROVIDER_MODE: z.enum(['demo', 'production']).default('demo'),
});

/**
 * Vector width for `moment_embeddings.embedding` (spec section 23). Baked
 * into the pgvector column at migration time, so it is a fixed constant
 * rather than an env var: switching families (e.g. 384 -> 1536) means a new
 * `workerVersion` plus a migration, never a mixed-dimension column.
 */
export const EMBEDDING_DIMENSIONS = 384;

/** Model providers never default to a paid API: local `fixture` output keeps
 * `pnpm test` deterministic and free of GPU/API dependencies (spec section 66). */
export interface ProviderConfig {
  kind: string;
  model: string | null;
}

/** The three LLM calls of the pipeline, each of which may run on its own model. */
export const LLM_STAGES = ['moments', 'narrative', 'director', 'subtitles'] as const;
export type LLMStage = (typeof LLM_STAGES)[number];

/**
 * LLM config: `model` is the default for every stage; `stageModels` holds the
 * `LLM_<STAGE>_MODEL` overrides (`null`/absent means "use `model`"), so the
 * narrative pass can run on a stronger model than moment suggestion.
 */
export interface LLMProviderConfig extends ProviderConfig {
  stageModels?: Partial<Record<LLMStage, string | null>>;
}

export interface AppConfig {
  databaseUrl: string;
  testDatabaseUrl: string | null;
  /** Absolute monorepo root. */
  rootDir: string;
  /** Absolute storage root, used for actual filesystem I/O. */
  storageDir: string;
  /**
   * The prefix stored keys carry, for a repo-relative `STORAGE_PATH` (e.g.
   * `storage`). Empty when `STORAGE_PATH` is absolute, in which case keys are
   * stored relative to the storage root itself. `storagePath`/`resolveStorage`
   * are the only things that should read it.
   */
  storageDirRelative: string;
  /** HTTP port for the API process. */
  apiPort: number;
  /** Interval of the API's job maintenance loop, in ms (F08). */
  jobMaintenanceIntervalMs: number;
  resources: Record<ResourceClass, number>;
  /** Width of every vector in `moment_embeddings.embedding` (spec section 23). */
  embeddingDimensions: number;
  /**
   * AI Gateway API key. Kept on config so it is not read ad hoc in workers
   * (spec section 65); the AI SDK also reads `AI_GATEWAY_API_KEY` from the env.
   * Required when `providers.llm.kind === 'gateway'`.
   */
  aiGatewayApiKey?: string | null;
  /** 'demo' allows fixture providers; 'production' requires real ones (F01). */
  providerMode: 'demo' | 'production';
  providers: {
    transcription: ProviderConfig;
    vision: ProviderConfig;
    llm: LLMProviderConfig;
    embedding: ProviderConfig;
    /** Not a `model-providers` abstraction: passed straight to the Python
     * audio analyzer, mirroring `TRANSCRIPTION_PROVIDER` (spec section 66). */
    audio: ProviderConfig;
  };
}

/**
 * Loads and validates configuration from the environment. Configuration is not
 * spread across workers (spec section 65): everything comes from here.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  // A repo-relative STORAGE_PATH keeps its prefix in stored keys, so rows
  // written by earlier versions keep resolving. An absolute one has no
  // meaningful repo-relative prefix, so keys are stored relative to the storage
  // root instead and `resolveStorage` reads both shapes — storage outside the
  // repo (e.g. `/dados/memetize`) now resolves correctly.
  const storageDirRelative = isAbsolute(parsed.STORAGE_PATH)
    ? ''
    : parsed.STORAGE_PATH.replace(/^\.\//, '').replace(/\/+$/, '');
  const testUrl = parsed.TEST_DATABASE_URL?.trim();
  return {
    databaseUrl: parsed.DATABASE_URL,
    testDatabaseUrl: testUrl && testUrl.length > 0 ? testUrl : null,
    rootDir: repoRoot,
    storageDir: resolve(repoRoot, parsed.STORAGE_PATH),
    storageDirRelative,
    apiPort: parsed.API_PORT,
    jobMaintenanceIntervalMs: parsed.JOB_MAINTENANCE_INTERVAL_MS,
    resources: {
      CPU_LIGHT: parsed.MAX_CPU_LIGHT_WORKERS,
      CPU_HEAVY: parsed.MAX_CPU_HEAVY_WORKERS,
      GPU: parsed.MAX_GPU_WORKERS,
      IO: parsed.MAX_IO_WORKERS,
      RENDER: parsed.MAX_RENDER_WORKERS,
    },
    embeddingDimensions: EMBEDDING_DIMENSIONS,
    aiGatewayApiKey: parsed.AI_GATEWAY_API_KEY?.trim() || null,
    providerMode: parsed.PROVIDER_MODE,
    providers: {
      transcription: {
        kind: parsed.TRANSCRIPTION_PROVIDER?.trim() || 'fixture',
        model: parsed.TRANSCRIPTION_MODEL?.trim() || null,
      },
      vision: {
        kind: parsed.VISION_PROVIDER?.trim() || 'fixture',
        model: parsed.VISION_MODEL?.trim() || null,
      },
      llm: {
        kind: parsed.LLM_PROVIDER?.trim() || 'fixture',
        model: parsed.LLM_MODEL?.trim() || null,
        stageModels: {
          moments: parsed.LLM_MOMENTS_MODEL?.trim() || null,
          narrative: parsed.LLM_NARRATIVE_MODEL?.trim() || null,
          director: parsed.LLM_DIRECTOR_MODEL?.trim() || null,
          subtitles: parsed.LLM_SUBTITLES_MODEL?.trim() || null,
        },
      },
      embedding: {
        kind: parsed.EMBEDDING_PROVIDER?.trim() || 'fixture',
        model: parsed.EMBEDDING_MODEL?.trim() || null,
      },
      audio: {
        kind: parsed.AUDIO_PROVIDER?.trim() || 'fixture',
        model: parsed.AUDIO_MODEL?.trim() || null,
      },
    },
  };
}
