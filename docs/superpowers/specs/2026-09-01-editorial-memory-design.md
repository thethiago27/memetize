# Editorial memory design

**Date:** 2026-09-01  
**Status:** Approved for planning  
**Branch:** `feat/editorial-memory`

## Objective

Make clip selection improve with use. Every generated video, clip swap, rating, ban, and editor note becomes a persisted feedback event. The Candidate Retriever, the Clip Ranker, and the Timeline Director read that memory so rejected choices are not repeated and confirmed choices rank higher.

Constraints carried over from the existing architecture:

- Planning decides the edit; FFmpeg only executes a valid timeline.
- Every decision stays deterministic given the database state and the configured providers.
- Everything works in fixture mode with no GPU or API call.
- Persistence is append-only; versions are never overwritten.

## Scope

In scope (this increment):

1. Feedback capture: events table, feedback embeddings table, API routes, CLI commands, Studio controls.
2. Ranker v2 and retriever: usage from feedback, cross-project novelty, ban filtering, feedback-driven retrieval, segment-level rejection rule.
3. Evaluation harness: replay past feedback against the current ranker and report top-1, top-3, MRR, and rejected-still-first.
4. Director prompt v3: templated lessons and few-shot examples from feedback.

Out of scope: learned ranker weights, embedding fine-tuning, LLM-summarised lessons, automatic critique of rendered video, emotion or narrative-function similarity in the ranker.

## Data model

### `feedback_events`

Append-only. Ids use the `fb_` prefix.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text pk | |
| `project_id` | text, nullable | No foreign key: memory outlives projects. |
| `timeline_version` | integer, nullable | The timeline version the event refers to. |
| `clip_id` | text, nullable | |
| `segment_id` | text, nullable | No foreign key: segments are replaced on narrative reprocess. |
| `moment_id` | text, nullable | No foreign key: memory outlives catalog reprocessing. |
| `asset_id` | text, nullable | |
| `kind` | text | CHECK on the kinds below. |
| `value` | real, nullable | 1 to 5 for `VIDEO_RATING`. |
| `note` | text, nullable | Free text for `NOTE`; optional reason on bans. |
| `context` | jsonb | `FeedbackContext`, `{}` when not applicable. |
| `source` | text | `USER` or `SYSTEM`. |
| `created_at` | timestamptz | |

Indexes on `moment_id`, `project_id`, `kind`.

Kinds and required fields:

| Kind | Source | Required | Meaning |
| --- | --- | --- | --- |
| `SWAP_OUT` | USER | project, timelineVersion, clip, segment, moment, asset, context | The editor removed this moment from this slot. |
| `SWAP_IN` | USER | same as above | The editor put this moment in this slot. |
| `CLIP_UP` | USER | project, timelineVersion, clip, segment, moment, asset, context | Thumbs up on a clip of the latest timeline. |
| `CLIP_DOWN` | USER | same as above | Thumbs down. |
| `VIDEO_RATING` | USER | project, timelineVersion, value, context.placements | Rating of the whole latest timeline. |
| `BAN_MOMENT` / `UNBAN_MOMENT` | USER | moment, asset | Exclude or re-admit a moment from retrieval. |
| `BAN_ASSET` / `UNBAN_ASSET` | USER | asset | Exclude or re-admit every moment of an asset. |
| `NOTE` | USER | note; project optional | Editorial note. Null project means global. |
| `PLACED` | SYSTEM | project, timelineVersion, clip, segment, moment, asset, context | Emitted once per clip when `EFFECTS` reaches `TIMELINE_READY`. |

`FeedbackContext` (Zod, all fields optional so every kind can use the same column):

```ts
{
  segmentId, startMs, endMs, emotion, narrativeFunction, visualIdeas, energy, lyrics, meaning,
  retrieved: RetrievedCandidate[],          // the segment's retrieval pool at event time
  placements: { momentId, segmentId, narrativeFunction }[]  // VIDEO_RATING only
}
```

Snapshotting `retrieved` and `placements` keeps aggregation and evaluation pure functions of the events table.

### `moment_feedback_embeddings`

Ids use the `fbe_` prefix.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text pk | |
| `feedback_event_id` | text fk → `feedback_events.id` cascade | |
| `moment_id` | text | |
| `asset_id` | text | |
| `polarity` | text | `POSITIVE` (from `SWAP_IN`) or `NEGATIVE` (from `SWAP_OUT`). |
| `source_text` | text | The embedded text, kept for debugging. |
| `embedding` | vector(EMBEDDING_DIMENSIONS) | HNSW cosine index. |
| `model`, `model_version` | text | Same provider identity as `moment_embeddings`. |
| `created_at` | timestamptz | |

Unique on `(feedback_event_id, model, model_version)`.

The source text is `buildFeedbackText(context)`: visual ideas joined by `; `, then meaning, then lyrics, separated by newlines, skipping empty parts.

### `segment_matches.feedback_cutoff_at`

Nullable timestamp of the newest feedback event the ranker considered. Recorded for reproducibility and inspection.

### New job type `FEEDBACK_EMBED`

Resource class `GPU`, worker version `1.0.0`, `entityId` = feedback event id, input `{ feedbackEventId }`. Only `SWAP_IN` and `SWAP_OUT` events produce a vector; any other kind completes as a no-op. The handler embeds through the configured `EmbeddingProvider` and upserts one row. Enqueued by `swapClip`; the API kicks a drain per event id, the CLI drains inline.

## Feedback capture

### Packages

`packages/feedback` (depends on contracts, database, shared, drizzle-orm; never on projects):

- `events.ts`: `recordFeedbackEvents(db, inputs)`, `listFeedbackEvents(db, filter)`.
- `bans.ts`: `resolveBans(events)` pure; `banMoment`, `unbanMoment`, `banAsset`, `unbanAsset`, `listActiveBans(db)`.
- `aggregate.ts`: `aggregateFeedback(events, { before? })` pure → `FeedbackAggregate`.
- `lessons.ts`: `buildLessons(...)` and `buildExamples(...)` pure.
- `text.ts`: `buildFeedbackText(context)`.
- `placement.ts`: `toPlacedEvents(timeline, segments, projectId, version)` pure.
- `embeddings.ts`: `upsertFeedbackEmbedding`, `listFeedbackEmbeddingsForMoment`.

`packages/projects/src/feedback.ts` (project-aware helpers): `rateProject`, `rateClip`, `addProjectNote`. They resolve the latest timeline, the clip's segment, and the segment's persisted retrieval pool to build the context.

### Swap

`swapClip` returns `{ timeline, events }`. It rejects banned moments with `MOMENT_BANNED` (409). After inserting the new timeline version it records `SWAP_OUT` for the previous moment and `SWAP_IN` for the new one, both with the segment context and `timelineVersion` of the new version, and enqueues one `FEEDBACK_EMBED` job per event.

### API

- `POST /v1/projects/:id/feedback` with body `{ kind: 'VIDEO_RATING', value }`, `{ kind: 'CLIP_UP' | 'CLIP_DOWN', clipId }`, or `{ kind: 'NOTE', note }`.
- `POST /v1/feedback/notes` with `{ note }` for a global note.
- `GET /v1/feedback?projectId=` lists events, newest first, including global notes.
- `POST` and `DELETE /v1/moments/:id/ban`, `POST` and `DELETE /v1/assets/:id/ban`.
- `GET /v1/projects/:id` adds `feedback: FeedbackEventRow[]` (this project plus global notes, newest first, capped at 50).
- `GET /v1/assets/:id` adds `banned: boolean`.

### CLI

- `feedback rate <projectId> <1-5>`
- `feedback clip <projectId> <clipId> --up | --down`
- `feedback note <text> [--project <projectId>]`
- `feedback list [--project <projectId>]`
- `moment ban <momentId> [--note]`, `moment unban <momentId>`
- `asset ban <assetId> [--note]`, `asset unban <assetId>`
- `eval ranker [--json]`

### Studio

- Candidates panel: when a clip is selected, "Keep" and "Miss" buttons record `CLIP_UP` / `CLIP_DOWN`; each shortlist row gains a "Ban" button.
- Project header: five rating buttons record `VIDEO_RATING` for the latest timeline.
- New "Editorial memory" panel: a note textarea and the project's recent events.
- Asset page: "Ban asset" / "Unban asset" with the current state.

## Ranker v2 and retrieval

### Aggregation (pure)

`aggregateFeedback(events, { before })` ignores events with `createdAt >= before` when `before` is given, then produces:

- `usage: Map<momentId, { wins, losses, byFunction: Map<narrativeFunction, { wins, losses }>, projects: Set<projectId> }>`
  - `SWAP_IN`, `CLIP_UP`: win, globally and for `context.narrativeFunction`.
  - `SWAP_OUT`, `CLIP_DOWN`: loss, globally and for `context.narrativeFunction`.
  - `VIDEO_RATING` with `value >= 4`: a win for every `context.placements` entry under its `narrativeFunction`; `value <= 2`: a loss; 3 is neutral.
  - `PLACED`, `SWAP_IN`: add `projectId` to `projects`.
- `bans: { momentIds: Set, assetIds: Set }`: the latest `BAN_*` / `UNBAN_*` event per id decides.
- `rejectedBySegment: Map<"projectId:segmentId", Set<momentId>>` from `SWAP_OUT`.
- `cutoffAt`: the newest `createdAt` considered, or null.

### Ranker

`RANK_WEIGHTS` are unchanged. Two terms change; ranker identity becomes `clip-ranker` `2.0.0` and `WORKER_VERSION.MATCH` becomes `2.0.0`.

- `usageScore`: let `rate(w, l) = (w + 1) / (w + l + 2)`. `base = 0.5 * rate(global) + 0.5 * rate(byFunction[segment.narrativeFunction])`. If the candidate's `negativeScore >= 0.75`, `usageScore = base * (1 - 0.5 * negativeScore)`; otherwise `usageScore = base`. With no feedback the score is exactly 0.5.
- `noveltyScore`: 0.2 when the moment is already shortlisted earlier in this project (unchanged). Otherwise `1 - 0.5 * min(otherProjects, 3) / 3`, where `otherProjects` counts projects in `usage.projects` other than the current one. Floor 0.5.

`RankParams` gains `usage: MomentUsageStats | undefined` and `projectId`. `RetrievedCandidate` gains `source: 'CATALOG' | 'FEEDBACK'` (default `CATALOG`) and `negativeScore` (default 0) so stored rows stay parseable.

### Retriever

- `searchMoments` accepts `exclude: { momentIds, assetIds }` and filters them in SQL.
- `searchFeedbackMoments(db, config, { query, polarity, limit, exclude })` searches `moment_feedback_embeddings` joined to `moments` and `READY` assets, same model filter.
- `retrieveForSegment(db, config, segment, { exclude, rejectedMomentIds })`:
  1. runs the catalog search and the `POSITIVE` feedback search per query, unions by moment, keeps the best score and records which source produced it;
  2. drops any moment in `rejectedMomentIds`;
  3. runs the `NEGATIVE` feedback search per query and sets `negativeScore` on matching candidates to the best similarity found;
  4. sorts by `semanticScore` and truncates to `RETRIEVE_LIMIT`.

### MATCH handler

Loads all feedback events once, aggregates, passes bans and the segment's rejected set to the retriever, passes usage and `projectId` to the ranker, and writes `feedbackCutoffAt`. The debug file records the aggregate summary per candidate.

### Rejection rule

A moment with a `SWAP_OUT` for `(projectId, segmentId)` never returns to that segment's retrieval pool. The rule is keyed on segment ids, so it holds across `reprocess --from match` and `--from director`; a narrative reprocess creates new segment ids and relies on the contextual statistics instead.

### EFFECTS handler

After `TIMELINE_READY`, records one `PLACED` event per clip with the segment context. `WORKER_VERSION.EFFECTS` becomes `1.1.0`.

## Evaluation harness

`packages/evaluation` (pure core plus a DB loader):

- `RankerCase`: `{ id, createdAt, projectId, segment, candidates: RetrievedCandidate[], target: momentId, expectation: 'CHOSEN' | 'REJECTED' }`. `SWAP_IN` yields a `CHOSEN` case; `SWAP_OUT` and `CLIP_DOWN` yield `REJECTED` cases. Candidates come from the event's `context.retrieved`; the target is always included in the pool (added with its own `semanticScore` when missing).
- `evaluateRanker({ cases, events, moments, rank })`: for each case, aggregates events with `before = case.createdAt`, ranks the pool with `previouslyShortlisted` empty and the case's project id, and finds the target's position. Reports:

```ts
{
  caseCount,
  chosen: { count, top1, top3, mrr },          // rates in [0, 1]
  rejected: { count, stillTop1 },              // rate in [0, 1]
  cases: { id, expectation, position }[]
}
```

- `loadRankerCases(db)` reads events and the moment rows the cases need.
- `pnpm cli eval ranker [--json]` prints a table and writes `storage/cache/eval/ranker-<timestamp>.json`.

Leave-one-out by time means each case is scored with only the feedback that existed before it, so the harness measures what the ranker would have done, not what it memorised.

## Director prompt v3

`DirectTimelineInput` gains `memory: { lessons: string[]; examples: DirectorExample[] }`. The fixture provider ignores it and keeps choosing the top shortlist entry. The gateway provider uses `DIRECTOR_PROMPT_V3` and passes `memory` in the JSON payload. `DIRECTOR_PROMPT_VERSION` becomes `v3`; `WORKER_VERSION.DIRECTOR` becomes `1.1.0`.

### Lessons (pure, deterministic)

`buildLessons({ aggregate, events, projectId, momentIds, describe, limits })`:

1. For every moment in the current shortlists that has any win or loss, one line, sorted by moment id:
   `Moment mom_x ("description"): 3 positive, 1 negative signals; chosen as payoff 2x; rejected as setup 1x.`
   Capped at 30 lines.
2. For `NOTE` events that are global or belong to this project, newest first, capped at 10:
   `Editor note: <text>`.

### Examples (pure, deterministic)

`buildExamples({ events, segments, describe, limit: 3 })`: walk the current segments in timeline order; for each, take the most recent `SWAP_IN` whose context has the same `narrativeFunction` and `emotion`; emit `{ narrativeFunction, emotion, meaning, lyrics, chosenMomentId, chosenDescription }`; skip duplicates; stop at three.

### Prompt text

`DIRECTOR_PROMPT_V3` is `DIRECTOR_PROMPT_V2` plus:

> You also receive `memory`: lessons distilled from the editor's past corrections and a few examples of what the editor chose for similar segments. Treat lessons as strong preferences: avoid moments the editor rejected in the same role, prefer moments the editor confirmed, and follow the editor's notes. Examples show taste, not mandatory picks. Never pick outside a segment's shortlist.

The Director debug file records `memory`.

## Testing

- Unit: aggregation, bans, lessons, examples, feedback text, placement events, ranker v2 terms, evaluation metrics.
- Integration (need `TEST_DATABASE_URL`): feedback repository, swap records events and enqueues jobs, ban rejects swap, retriever excludes bans and merges feedback vectors, `FEEDBACK_EMBED` handler, project feedback helpers, `loadRankerCases`.
- E2E: after a swap, `reprocess --from match` leaves the rejected moment out of that segment's pool and the shortlist; the Director debug file carries the lessons; `PLACED` events exist after `EFFECTS`.
- API: routes for feedback, notes, bans, and the extended project and asset payloads.

## Migration and documentation

- `packages/database/drizzle/0011_editorial_memory.sql` generated by `drizzle-kit`.
- `truncateAll` covers the new tables.
- `README.md` gains a "Feedback and editorial memory" section; `CHANGELOG.md` lists the changes.
