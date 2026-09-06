# Editorial Memory Implementation Plan

**Goal:** Persist editorial feedback and make retrieval, ranking, and the Director consume it deterministically, with an evaluation harness that measures the effect.

**Spec:** `docs/superpowers/specs/2026-09-01-editorial-memory-design.md`

**Tech Stack:** TypeScript 5.9, Node.js 22, pnpm/Turborepo, Vitest, Zod, Drizzle/PostgreSQL + pgvector, Fastify, Next.js/React, commander.

## Global Constraints

- Write a failing test before each production-code slice where a public seam exists.
- Add no external dependency. Internal workspace dependencies use `workspace:*`.
- Store all times as integer milliseconds; all scores in `[0, 1]`.
- Feedback tables carry no foreign keys to projects, moments, or assets; memory outlives them.
- Fixture mode must stay deterministic and free of GPU/API calls.
- Work only on `feat/editorial-memory`; commit one slice at a time.
- Update `CHANGELOG.md` and `README.md` before finishing.

## File Structure

### Contracts, database, shared

- `packages/contracts/src/feedback.ts` (+ test): `FeedbackKind`, `FeedbackSource`, `FeedbackPolarity`, `FeedbackContext`, `FeedbackEmbedInput`, `ProjectFeedbackInput`, `NoteInput`.
- `packages/contracts/src/enums.ts`: `FEEDBACK_EMBED` job type.
- `packages/contracts/src/registry.ts`: resource class and versions (`MATCH` 2.0.0, `DIRECTOR` 1.1.0, `EFFECTS` 1.1.0, `FEEDBACK_EMBED` 1.0.0).
- `packages/contracts/src/match.ts`: `RetrievedCandidate.source`, `RetrievedCandidate.negativeScore`.
- `packages/database/src/schema.ts`: `feedback_events`, `moment_feedback_embeddings`, `segment_matches.feedback_cutoff_at`.
- `packages/database/drizzle/0011_editorial_memory.sql` + meta snapshot.
- `packages/database/src/testing.ts`: truncate new tables.
- `packages/shared/src/ids.ts`: `fb_`, `fbe_` prefixes.

### Feedback package

- `packages/feedback/package.json`, `tsconfig.json`, `src/index.ts`.
- `src/events.ts` (+ integration test), `src/bans.ts` (+ tests), `src/aggregate.ts` (+ test), `src/text.ts` (+ test), `src/placement.ts` (+ test), `src/lessons.ts` (+ test), `src/embeddings.ts` (+ integration test).

### Pipeline

- `packages/retriever/src/search.ts`, `feedback-search.ts`, `retrieve.ts` (+ integration tests).
- `packages/clip-ranker/src/rank.ts` (+ tests).
- `workers/matching/src/handler.ts`.
- `workers/feedback-embedder/` new worker package with `handler.ts` (+ integration test).
- `workers/effects/src/handler.ts`: `PLACED` events.
- `packages/runtime/src/registry.ts`: register `FEEDBACK_EMBED`.
- `packages/model-providers/src/types.ts`, `fixture.ts`, `gateway.ts`; `packages/prompts/src/director.ts`.
- `workers/director/src/handler.ts`: build memory, pass it, record it in the debug file.

### Projects, evaluation, product surface

- `packages/projects/src/swap.ts` (+ integration test), `src/feedback.ts` (+ integration test), `src/paths.ts` (`evalReportFile`).
- `packages/evaluation/` new package: `src/cases.ts`, `src/evaluate.ts` (+ test), `src/load.ts` (+ integration test), `src/index.ts`.
- `apps/api/src/routes/feedback.ts`, `routes/projects.ts`, `routes/assets.ts`, `app.ts`, `errors.ts`, `app.test.ts`.
- `apps/cli/src/commands/feedback.ts`, `eval.ts`, `moment.ts`, `asset.ts`, `index.ts`.
- `apps/web/src/lib/api.ts`, `app/projects/[id]/page.tsx`, `app/assets/[id]/page.tsx`.
- `apps/cli/src/matching.e2e.test.ts` or `director.e2e.test.ts`: rejection rule and lessons.
- `README.md`, `CHANGELOG.md`.

---

## Phase 1: Capture

- [x] **Task 1: Contracts and ids.** Feedback enums, context schema, job type, versions, `RetrievedCandidate` defaults, id prefixes. Tests for schema defaults and version bumps.
- [x] **Task 2: Schema and migration.** Tables, column, truncate list. Generate `0011_editorial_memory.sql`; run `pnpm db:migrate` against the dev DB and confirm the test DB migrates in the integration suite.
- [x] **Task 3: Feedback package core.** `recordFeedbackEvents`, `listFeedbackEvents`, `resolveBans` + ban helpers, `buildFeedbackText`, `toPlacedEvents`. Unit tests for the pure parts, integration test for the repository.
- [x] **Task 4: Aggregation.** `aggregateFeedback` with `before` cutoff, wins/losses per function, projects, bans, rejected-by-segment, cutoff timestamp. Unit tests covering each kind and the cutoff.
- [x] **Task 5: Swap emits feedback.** `swapClip` returns `{ timeline, events }`, rejects banned moments, records `SWAP_OUT`/`SWAP_IN` with context, enqueues `FEEDBACK_EMBED`. Integration tests.
- [x] **Task 6: Project feedback helpers.** `rateProject`, `rateClip`, `addProjectNote` in `packages/projects`. Integration tests.
- [x] **Task 7: `FEEDBACK_EMBED` worker.** Handler, registry entry, integration test with the fixture embedding provider.
- [x] **Task 8: `PLACED` from EFFECTS.** Emit events after `TIMELINE_READY`; extend the existing effects tests.
- [x] **Task 9: API.** Feedback routes, ban routes, extended project and asset payloads, error mapping. `app.test.ts` coverage.
- [x] **Task 10: CLI.** `feedback`, `moment ban/unban`, `asset ban/unban`.
- [x] **Task 11: Studio.** API client methods and types; rating, keep/miss, ban, notes, memory panel; asset ban toggle. `pnpm --filter @memetize/web build` passes.

## Phase 2: Ranker v2 and retrieval

- [x] **Task 12: Ranker v2.** `usage` and `projectId` params; smoothed usage with function context and negative penalty; cross-project novelty. Unit tests for neutral defaults, wins/losses, penalty threshold, novelty floor.
- [x] **Task 13: Retriever.** Exclusions in `searchMoments`; `searchFeedbackMoments`; `retrieveForSegment` union, rejection filter, negative scores. Integration tests.
- [x] **Task 14: MATCH handler.** Load and aggregate feedback once, wire exclusions, usage, rejected sets, `feedbackCutoffAt`, ranker `2.0.0`, debug summary. E2E: rejected moment absent after `reprocess --from match`.

## Phase 3: Evaluation harness

- [x] **Task 15: Evaluation core.** `buildRankerCases`, `evaluateRanker`, metrics. Unit tests with synthetic events.
- [x] **Task 16: Loader and CLI.** `loadRankerCases(db)`, `eval ranker [--json]`, report file. Integration test for the loader.

## Phase 4: Director memory

- [x] **Task 17: Lessons and examples.** `buildLessons`, `buildExamples`. Unit tests for ordering, caps, dedupe.
- [x] **Task 18: Provider contract and prompt v3.** `memory` on `DirectTimelineInput`, prompt v3, fixture unchanged, gateway payload. Tests for prompt version and fixture determinism.
- [x] **Task 19: Director handler.** Build memory from feedback and current shortlists; record it in the debug file. E2E assertion on the debug file. (2026-09-06: the E2E only asserted an *empty* memory, so a handler that never built lessons would have passed. `director.e2e.test.ts` now seeds feedback and asserts the lessons reach the debug file.)

## Phase 5: Wrap-up

- [x] **Task 20: Docs.** README section, CHANGELOG entries.
- [x] **Task 21: Verification.** `pnpm exec vitest run`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @memetize/web build`. (All four run in CI as of 2026-09-06.)
