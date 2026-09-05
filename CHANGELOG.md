# Changelog

## Unreleased

- Burn translated TikTok-style captions into the render: `SUBTITLES` translates
  lyric lines to `pt-BR` (fixture keeps the original), rasterizes them with
  Inter Bold, and FFmpeg overlays the PNGs. `LLM_SUBTITLES_MODEL` overrides the
  gateway model. `project reprocess --from subtitles` re-translates without
  touching the timeline. Existing projects with lyrics must run that once
  before render (`RENDER_SUBTITLES_MISSING`).

- Per-stage LLM models: `LLM_MOMENTS_MODEL`, `LLM_NARRATIVE_MODEL` and `LLM_DIRECTOR_MODEL` override `LLM_MODEL` for one gateway stage each; provenance (`extractorVersion` / `directorVersion`) records the model that actually ran.
- Cap the output window at 30 seconds (`MAX_OUTPUT_DURATION_MS`, `MANUAL_WINDOW_MAX_MS`, Studio copy and bounds): tracks up to 30 s render in full, longer ones get a 30 s highlight.
- Accept a rendered video stream that ends somewhat before the audio as a `DURATION_DRIFT` warning when it still covers at least 80% of the timeline (`VIDEO_MIN_COVERAGE`); a truncated video, unknown coverage, or a late-starting stream remain hard failures.

- Fix renders rejected with `RENDER_OUTPUT_INVALID` because the video stream came out a few frames shorter than the audio: every clip segment is now placed on the output frame grid and cut to an exact frame count (`fps`, a short clone pad, `trim=end_frame`), and xfade offsets/durations are expressed in whole frames, so the concatenated video is exactly `durationMs` long instead of losing up to one frame per cut.

- Fix a spurious `INSUFFICIENT_CATALOG` when a segment's retrieved candidates are all shorter than the segment while the catalog has longer moments: the retriever runs a duration-filtered pass when the semantic top-k cannot cover the segment (`coverDurationMs`), the ranked list keeps at least two covering candidates (`ensureCoverageCandidates`), and the coverage resolver falls back to the eligible catalog (`catalog fallback` decisions) before giving up.

- Atomic job publication (F08/F09/F10): a worker's domain writes, follow-up jobs, job completion and fan-in barriers commit in one transaction under the entity lock, only while the attempt still holds its lease and its generation is the active one. A stale attempt publishes nothing (`LEASE_LOST`); a superseded one ends `CANCELLED`. Barriers are evaluated inside that transaction, so a crash can no longer land between "both siblings done" and "NARRATIVE/VISION_ANALYZE enqueued". `createOrchestrator` in `@memetize/runtime` is the single wiring for CLI, API and E2E tests.
- Generations (F09/F11): `project create/generate/render/reprocess` and `asset add/reprocess` start a new generation under the entity lock; jobs carry `generationId` (part of the idempotency hash) and a step key, PENDING jobs of superseded stages become `CANCELLED` and history is kept. `TIMING`/`EFFECTS`/`RENDER` are pinned to the timeline version (and render to the edit window version) they must consume; a missing pinned row fails the job instead of rendering "latest". Reprocess/generate/render return `409` while a stage job is RUNNING (`ASSET_BUSY` joins `PROJECT_BUSY`).
- Recovery (F08): the API reconciles at startup and every `JOB_MAINTENANCE_INTERVAL_MS`, draining runnable work so crashed attempts resume without a request; RUNNING jobs with a `NULL` lease (pre-upgrade rows) are treated as expired. Migration `0015` backfills leases, coordination counters and moment identities; see the README's upgrade procedure.
- Render publication (F09): the validated encode is parked as `ready.mp4` and moved to its version-named path inside the same transaction as the `renders` row and the job completion; stale `attempt-*` directories are swept before each render.
- Clip swaps run in one transaction under the project lock and accept `expectedTimelineVersion` (`409 VERSION_CONFLICT` on a stale version); timeline/render/window versions come from the per-entity counters.
- Editorial identity (F12): `moment_identities` gives each exact source interval of an asset one moment id for good, across extractors, model versions and re-appearance; a re-extraction replaces the asset's moments wholesale so no stale extractor rows linger.
- Director (F13): the constraints revision (from ban/unban events) is read before the model call and compared at publication; a ban that landed meanwhile re-validates the clips and re-plans (`DIRECTOR_CONSTRAINTS_CHANGED`, retryable).
- Timing (F05): when a beat snap grows a clip, the extra source is taken from both ends so the transition handle coverage reserved survives to Effects; the F05 integration test now runs the real Timing pass.
- Render validation (F07): unknown stream coverage is rejected (`STREAM_COVERAGE_UNKNOWN`) and streams that start late fail (`STREAM_START_OFFSET`); the probe measures stream spans from packets when the header lacks a duration and records start times.
- Providers (F01): the gateway embedding provider requests the catalog's vector width (`openai/text-embedding-3-small` now yields 384-wide vectors instead of `EMBEDDING_DIMENSION_MISMATCH`); vision frame paths are resolved against the repo root so the Studio API works from `apps/api`; gateway provenance versions name the model (`1.0.0/<creator/model>`); `GET /v1/health`, `GET /v1/projects/:id` and `project inspect` report which capabilities are real vs. fixture.
- Docs: README covers `PROVIDER_MODE`, gateway providers, generations/recovery, the integration gate and the upgrade procedure; `.env.example` gains `PROVIDER_MODE` and `JOB_MAINTENANCE_INTERVAL_MS`.

- Restyle Studio with Tailwind CSS v4, Outfit, and a cool Afterglow palette (coral signal on graphite) while keeping the existing semantic classes.
- Give the Studio editor one clock: a transport bar (play, pause, timecode, position slider) drives either the rendered video or, when there is no current render, a storyboard that plays the project's music while the preview shows the thumbnail of the clip under the playhead. The timeline strip now spans the editor's width, measures itself so pointer positions map exactly to time, gets a ruler with downbeat marks and a draggable playhead, and selects a clip on a plain click. A stale render can still be watched through "Ver render vN". Clip swaps show the returned timeline before the reload, buttons disable only on their own action, and rows in the Narrativa tab select their clip. The editor fits the viewport: a one-line header, pipeline chips, the preview sized to the height left beside a scrolling inspector, and the strip pinned at the bottom, with the tabs below.
- `GET /v1/media/*` honors HTTP `Range` requests (`206`, `Accept-Ranges`, `416`), so the browser can seek inside renders and music instead of restarting the download from zero on every seek.
- Choose the stretch of the song by hand: `PUT`/`DELETE /v1/projects/:id/window`, `pnpm cli project window --start --end | --auto`, and "Escolher trecho" on the Studio's Análise tab (drag the band or its edges with downbeat snapping, refine in mm:ss, 5 to 60 seconds). The pick lives on the project (`manual_window_start_ms` / `manual_window_end_ms`), `NARRATIVE` honors it with `selector = 'manual'`, and saving or clearing reruns the pipeline from narrative.
- Add an "Análise" tab to the Studio editor: sections, energy curve with beats and downbeats, and every lyric line on one source-time axis, with the selected 60-second window highlighted. The playhead follows the preview, the current lyric line lights up, and clicking inside the window seeks the video. No API change.
- Delete a project: `DELETE /v1/projects/:id`, `pnpm cli project delete`, and an "Excluir" button with confirmation in the Studio editor. Removes jobs, derived rows, and storage under `audio/`, `cache/`, and `renders/`; keeps `feedback_events` (editorial memory); answers `409 PROJECT_BUSY` while a job is RUNNING.

- Add cut styles: the Director (prompt `v4`) proposes a transition (`hard`, `dip_black`, `flash`, `crossfade`, `whip`) per segment boundary and a clip style (`hold`, `speed_up`, `slow_down`) per primary clip; a deterministic resolver in `EFFECTS` validates each proposal against tempo, slot lengths, and real source handles, downgrades what cannot render, and records why on the clip and in `effects.json`. The FFmpeg graph renders them with `xfade`, `fade`, `tpad`, and `setpts` while keeping slots contiguous and the output length exact. `WORKER_VERSION.DIRECTOR` and `EFFECTS` 1.2.0.
- The renderer validates before touching media, rejects a timeline whose duration disagrees with the selected edit window (`TIMELINE_DURATION_MISMATCH`), and rejects transitions over a third of the smaller neighboring slot, overlapping transitions without a head handle, or incoming plus outgoing transitions that exceed a slot.
- Clip swaps re-resolve cut styles against the new moment's bounds.
- The Studio strip marks non-hard boundaries and styled clips; the Inspector gains a "Corte" section with the resolved transition and the downgrade reason in Portuguese.
- `LLM_PROVIDER=fixture LLM_MODEL=styled` makes the fixture Director propose every style by segment position, for tests.

- Exclude source ranges of an asset (`EXCLUDE_RANGE` / `INCLUDE_RANGE` feedback events): every moment touching an excluded range is banned from retrieval and swaps, surviving reprocessing. Exposed as `POST`/`DELETE /v1/assets/:id/exclusions`, `pnpm cli asset exclude|include`, and per-scene, per-moment, and custom-range controls on the Studio asset page.

- Fix a spurious `INSUFFICIENT_CATALOG`: the coverage resolver now tries every duration-compatible candidate in preference order instead of giving up when the Director's pick would leave an unabsorbable tail.

- Redesign the Studio in Portuguese: projects home with cards and a new-project dialog, an editor with pipeline stepper, 9:16 preview, horizontal timeline strip with thumbnails and seek, a clip inspector with segment, current moment, and candidates, tabs for narrative, renders, editorial memory, and jobs, a library grid with drag-and-drop upload, an asset page with scene frames, and toasts for every action.
- `GET /v1/projects/:id` returns `moments`: descriptions, asset names, and nearest frames for every referenced moment.

- Add editorial memory: append-only `feedback_events` (swaps, clip thumbs, video ratings, bans, notes, system placements) and `moment_feedback_embeddings` learned from swaps, with a `FEEDBACK_EMBED` job.
- Record `SWAP_OUT` / `SWAP_IN` on every clip swap, `PLACED` per clip at `TIMELINE_READY`, and expose rating, thumbs, notes, and bans in the API, CLI, and Studio.
- Clip ranker 2.0.0: usage from smoothed win rates (overall and per narrative role), damping for moments rejected from similar segments, cross-project novelty; `WORKER_VERSION.MATCH` 2.0.0.
- Retriever excludes banned moments and assets, drops moments swapped out of the same segment, and merges POSITIVE feedback vectors as candidates while flagging NEGATIVE matches.
- Add `pnpm cli eval ranker`: replays past editorial decisions against the current ranker with leave-one-out-by-time and reports top-1, top-3, MRR, and rejected-still-first.
- Director prompt v3 with `memory` (templated lessons, editor notes, few-shot examples); `WORKER_VERSION.DIRECTOR` 1.1.0, `EFFECTS` 1.1.0.

- Select a deterministic edit window: the full track when it is at most 60 seconds, otherwise exactly 60,000 ms scored by section, energy, lyrics, narrative arc, and boundaries.
- Persist selected windows append-only and show the range, duration, selector, and score in the API, CLI, and Studio.
- Plan continuous narrative coverage, including instrumental gaps, with `LYRIC` / `INSTRUMENTAL` source kinds.
- Scope narrative analysis to the selected window (prompt v2).
- Keep six diverse match candidates and allow non-adjacent asset reuse.
- Resolve every edit span into usable clips, including fallback and tiling; fail with `INSUFFICIENT_CATALOG` instead of leaving holes.
- Snap shared clip boundaries to beats and rebase musical times onto the zero-based timeline.
- Reject empty, gapped, or source-short timelines before FFmpeg. Drop black-gap and clone-pad fallbacks. Rebase audio timestamps and fade only at cropped window edges.
- Record renderer wall-time metrics in `render.json`.
- Surface catalog-failure guidance in Studio when a job fails with `INSUFFICIENT_CATALOG`.
