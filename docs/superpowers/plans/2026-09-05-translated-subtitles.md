# Translated Subtitles Implementation Plan

**Goal:** Translate a project's lyrics to `pt-BR` in a new `SUBTITLES` pipeline step and burn them into every render as bottom-third captions, using PNG overlays so the result is identical on any FFmpeg build.

**Spec:** `docs/superpowers/specs/2026-09-05-translated-subtitles-design.md`

**Status (2026-09-05):** implemented on `main` by PRs #2 (`6e5ee23`) and #3 (`9948daa`), reviewed against the spec. All tasks below are covered; Task 19's Studio walkthrough was not performed, the automated checks were (typecheck 40/40, unit 553 pass, feature integration/E2E 28 pass). Review follow-ups applied the same day: the SUBTITLES enqueue payload carries `generationId`, the E2E-only delete helper moved to `@memetize/database` testing, the caption PNG reserves padding for outline and shadow, and Biome parses Tailwind directives so `pnpm lint` passes. Migration `0016` was applied to the local dev and test databases.

**Tech Stack:** TypeScript 5.9, Node.js 22+, pnpm/Turborepo, Vitest, Zod, Drizzle/PostgreSQL, Fastify, Next.js/React, FFmpeg, `@napi-rs/canvas` (new).

## Global Constraints

- Write a failing test before each production-code slice where a public seam exists.
- One new external dependency only: `@napi-rs/canvas` in `@memetize/renderer`. It ships prebuilt binaries as platform optional dependencies, so `onlyBuiltDependencies` in `pnpm-workspace.yaml` stays as it is.
- All times are integer milliseconds; FFmpeg expressions use `toSeconds` (ms precision).
- `buildFfmpegGraph` without cues stays byte-identical to today; no existing graph test changes.
- The fixture LLM stays deterministic and free of API calls.
- The renderer never imports `@memetize/model-providers`.
- Work on `feat/translated-subtitles`; commit one slice at a time.
- Update `CHANGELOG.md`, `README.md`, `.env.example` before finishing.

## File Structure

### Contracts, registry, config

- `packages/contracts/src/enums.ts`: `JobType` + `SUBTITLES`.
- `packages/contracts/src/audio.ts` (+ `audio.test.ts`): `SubtitlesInput`, `SubtitleLine`, `SubtitlesOutput`.
- `packages/contracts/src/registry.ts`: `SUBTITLES: 'CPU_LIGHT'`, version `1.0.0`; `RENDER` version `1.1.0`.
- `packages/shared/src/config.ts`: `LLM_STAGES` + `'subtitles'`, `LLM_SUBTITLES_MODEL`.

### Model provider

- `packages/prompts/src/subtitles.ts` (+ test): `SUBTITLES_PROMPT`, `SUBTITLES_PROMPT_VERSION`, `buildSubtitlesPrompt(lines, targetLanguage)`.
- `packages/model-providers/src/types.ts`: `TranslateLyricsInput`, `TranslateLyricsResult`, `LLMProvider.translateLyrics`.
- `packages/model-providers/src/fixture.ts` (+ test): passthrough.
- `packages/model-providers/src/gateway.ts` (+ test): `TranslationSchema`, one internal retry on line-count mismatch.

### Database and projects

- `packages/database/src/schema.ts`: `subtitles` table; `SubtitlesRow`, `NewSubtitlesRow` types.
- `packages/database/drizzle/0016_subtitles.sql` via `pnpm db:generate`.
- `packages/projects/src/subtitles.ts` (+ `subtitles.integration.test.ts`): `replaceSubtitles`, `getSubtitles`.
- `packages/projects/src/paths.ts`: `subtitlesDebugFile`.
- `packages/projects/src/reprocess.ts` (+ integration test): stage `subtitles`, `lyrics` supersedes `SUBTITLES`, render busy while `SUBTITLES` runs.
- `packages/projects/src/index.ts`: export `subtitles`.

### Worker

- `workers/subtitles/{package.json,tsconfig.json,src/index.ts,src/handler.ts,src/handler.integration.test.ts}`: `@memetize/subtitles`, `createSubtitlesHandler`.
- `packages/runtime/src/registry.ts`: register `SUBTITLES`.
- `packages/runtime/src/runtime.ts` (+ test): `evaluateBarriers` enqueues `SUBTITLES` after `LYRICS`.
- `packages/runtime/package.json`: depend on `@memetize/subtitles`.

### Renderer

- `packages/renderer/package.json`: `@napi-rs/canvas`.
- `packages/renderer/assets/fonts/Inter-Bold.ttf` + `OFL.txt`.
- `packages/renderer/src/subtitles/constants.ts`: style constants from the spec.
- `packages/renderer/src/subtitles/cues.ts` (+ test): `cuesFromLyrics`.
- `packages/renderer/src/subtitles/layout.ts` (+ test): `loadSubtitleFont`, `layoutCue`.
- `packages/renderer/src/subtitles/raster.ts` (+ test): `rasterizeCue`.
- `packages/renderer/src/subtitles/index.ts`: re-exports and `RenderedCue` type.
- `packages/renderer/src/types.ts`: `FfmpegInput.kind` + `'image'`, `RenderedCue`.
- `packages/renderer/src/graph.ts` (+ `graph.test.ts`): optional `options.subtitles`, `[vjoin]` rename, overlay chain.
- `packages/renderer/src/constants.ts`: `RENDERER_VERSION = '1.1.0'`.
- `workers/renderer/src/handler.ts`: load lyrics/subtitles, `RENDER_SUBTITLES_MISSING`, rasterize into the attempt dir, debug info.
- `workers/renderer/package.json`: depend on `@memetize/projects` already present; nothing new.

### API, CLI, Studio

- `apps/api/src/routes/projects.ts` (+ `app.test.ts`): `subtitles` in `GET /v1/projects/:id`.
- `apps/cli/src/commands/project.ts`: `subtitles:` line in `inspect`; `--from subtitles` accepted by the stage parser.
- `apps/web/src/lib/api.ts`: `ProjectDetail.subtitles`.
- `apps/web/src/lib/labels.ts`: `SUBTITLES: 'Legendas'` in `JOB_LABEL` and `PIPELINE_STEPS` (after `Letra`).
- `apps/web/src/components/editor/RendersTab.tsx`: one `Legendas:` line.

### Docs

- `README.md`, `CHANGELOG.md`, `.env.example`.
- `.github/workflows/integration.yml`: no change expected; verify the canvas binary resolves on `ubuntu-latest`.

---

## Phase 1: Contracts and config

- [x] **Task 1: Job type, contracts, registry.** Add `SUBTITLES` to `JobType`; `SubtitlesInput`, `SubtitleLine`, `SubtitlesOutput` in `audio.ts` with tests (integer ms, non-negative, `lineCount` non-negative). Registry: `CPU_LIGHT`, `1.0.0`. Bump `RENDER` to `1.1.0` and `RENDERER_VERSION` to `'1.1.0'`; fix any version assertion tests.
- [x] **Task 2: LLM stage.** `LLM_STAGES` + `'subtitles'`, env `LLM_SUBTITLES_MODEL` parsed into `stageModels.subtitles`. Config test covers the override and the fallback to `LLM_MODEL`. Document in `.env.example`.

## Phase 2: Model provider

- [x] **Task 3: Prompt.** `packages/prompts/src/subtitles.ts`: prompt text asking for a natural line-by-line translation, same count and order, proper nouns kept, `alreadyTargetLanguage` when the source already is the target. Test: the prompt embeds every input line numbered and the target language.
- [x] **Task 4: Provider interface and fixture.** Add `translateLyrics` to `LLMProvider`; fixture returns `{ lines: input, sourceLanguage: 'und', translated: false, model: 'fixture', modelVersion: '1.0.0', promptVersion }`. Test: passthrough keeps order and count; empty input returns empty.
- [x] **Task 5: Gateway.** `TranslationSchema = { sourceLanguage, alreadyTargetLanguage, lines }`; `generateObject` with `this.modelFor('subtitles')`; on `lines.length !== input.length` retry once, then throw `Error('translateLyrics: expected N lines, got M')`. Tests with mocked `generateObject`: translation, already-Portuguese (`translated: false`, lines returned as given), mismatch then success, mismatch twice throws.

## Phase 3: Database and projects

- [x] **Task 6: Schema and migration.** `subtitles` table per spec; `pnpm db:generate` → `0016_subtitles.sql`; check the SQL is additive only. `SubtitlesRow`/`NewSubtitlesRow` types.
- [x] **Task 7: Persistence.** `replaceSubtitles(db, { projectId, language, sourceLanguage, translated, lines, model, modelVersion })` deletes all rows for the project and inserts one, in a transaction; `getSubtitles(db, projectId)` returns the row or `undefined`; `subtitlesDebugFile`. Integration test: insert, replace leaves exactly one row, cascade on project delete.
- [x] **Task 8: Reprocess stages.** `REPROCESS_STAGES` + `'subtitles'`; `STAGE_JOBS.lyrics` + `SUBTITLES`; `STAGE_JOBS.subtitles = ['SUBTITLES', 'RENDER']`; `case 'subtitles'` enqueues `SUBTITLES { projectId }`. Busy guard: for `from === 'render'` the RUNNING check also counts `SUBTITLES` without cancelling it (a `BLOCKING_JOBS` map, defaulting to the stage's own jobs). Integration tests: each new supersede path, render busy while a `SUBTITLES` job is RUNNING, `--from subtitles` keeps `timeline_versions`.

## Phase 4: Worker and barrier

- [x] **Task 9: Worker package.** Scaffold `workers/subtitles` from `workers/narrative-analyzer`. Handler per spec steps 1 to 7 with `SUBTITLE_TARGET_LANGUAGE = 'pt-BR'`; empty translated lines fall back to the original text. Integration tests with the fixture provider: persists passthrough with `translated: false`; instrumental project persists an empty row and never calls the provider (inject a spy provider through `createProviders` mocking or a handler option); a provider returning the wrong count yields `JobFailure('SUBTITLES_INVALID_OUTPUT')` with `retryable: true`; missing lyrics row yields `SUBTITLES_NO_LYRICS`.
- [x] **Task 10: Register and chain.** `buildRegistry` adds `SUBTITLES`. `evaluateBarriers`: on `LYRICS` completion also `enqueueJob(tx, { type: 'SUBTITLES', entityId, input: { projectId, generationId }, generationId, stepKey: stepKeyFor('SUBTITLES') })`. Test: LYRICS completion enqueues exactly one SUBTITLES per generation; AUDIO_ANALYZE completion does not.

## Phase 5: Renderer

- [x] **Task 11: Dependency and font.** Add `@napi-rs/canvas` to `@memetize/renderer`; download `Inter-Bold.ttf` from the Inter 4.x release (`github.com/rsms/inter`) into `packages/renderer/assets/fonts/` with `OFL.txt`; resolve the path from `import.meta.url`. Smoke test: `loadSubtitleFont()` registers the family and `measureText` returns a positive width.
- [x] **Task 12: Cues.** `cuesFromLyrics(lines, timeline)`: offset by `sourceStartMs`/`timelineStartMs`, clamp, drop outside/sub-frame/empty, trim overlaps, sort. Tests for each rule plus a window that starts mid-line.
- [x] **Task 13: Layout.** `layoutCue(text, canvas, style)`: greedy word wrap by `measureText`, max 3 lines, shrink to `MIN_FONT_SCALE`, hard-wrap an overlong word, return `{ lines, fontSize, width, height }`. Tests: short line stays one line; long line wraps to two; very long shrinks; single 200-char word hard-wraps; dimensions are integers and stable across two calls.
- [x] **Task 14: Raster.** `rasterizeCue(layout, style)` → PNG `Buffer` (outline, fill, shadow, centered). Test: PNG signature, decoded width/height match the layout, center pixel of the first line is opaque, a corner pixel is transparent.
- [x] **Task 15: Graph.** `buildFfmpegGraph(timeline, assets, { subtitles })`: image inputs appended after video inputs; join emits `[vjoin]` when cues exist; overlay chain with `x=(W-w)/2`, `y=<baseline - height>`, `enable='between(t,a,b)'`; last label `[vout]`. Tests: no-cues graph equals current output for the existing fixtures; with two cues the filter string has the expected inputs, labels and `enable` windows; `toFfmpegArgs` emits `-i` for image inputs in order.
- [x] **Task 16: Render handler.** Load `getLyrics`/`getSubtitles`; lyrics with lines and no subtitles row → `RENDER_SUBTITLES_MISSING`; rasterize cues to `target.directory/subtitles/cue-<i>.png`; pass to `buildFfmpegGraph`; debug file `subtitles: { lineCount, cueCount, translated, model }`. Extend `apps/cli/src/renderer.e2e.test.ts`: (a) lyrics project renders valid MP4 and a frame at a cue midpoint differs in the caption band from the instrumental render; (b) lyrics project with the `subtitles` row deleted fails with `RENDER_SUBTITLES_MISSING`; (c) existing instrumental cases unchanged.

## Phase 6: API, CLI, Studio

- [x] **Task 17: API and CLI.** `GET /v1/projects/:id` returns `subtitles` (`null` when no row); `app.test.ts` asserts the shape. `project inspect` prints `subtitles: pt-BR · translated from <src> · <n> lines · <model>` or `subtitles: original lines (…)`; `reprocess --from subtitles` accepted.
- [x] **Task 18: Studio.** `api.ts` type; `labels.ts` entries; `RendersTab` line `Legendas: traduzidas de <src> · <n> linhas` / `Legendas: letra original` / `Legendas: pendentes`. Existing Stepper picks the new step up from `PIPELINE_STEPS`.

## Phase 7: Verification and docs

- [x] **Task 19: Full verification.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:integration` (needs `TEST_DATABASE_URL`, FFmpeg). Manual: `pnpm studio`, create a project with an English `.lrc`, render, watch captions in the preview; instrumental project renders as before; `reprocess --from subtitles` re-renders.
- [x] **Task 20: Docs.** README (pipeline step, `LLM_SUBTITLES_MODEL`, `--from subtitles`, upgrade note for pre-existing projects), CHANGELOG, `.env.example`. Confirm CI resolves the canvas binary on `ubuntu-latest`.
