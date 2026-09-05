# Memetize

Local AI meme-video editor. It catalogs source clips, analyzes a song, selects a musical window, plans continuous visual coverage, and renders a vertical MP4. Planning owns the edit; FFmpeg only executes a complete timeline.

## Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io/) 11
- PostgreSQL (for `DATABASE_URL` and, for integration/E2E, `TEST_DATABASE_URL`)
- [uv](https://github.com/astral-sh/uv) for the Python workers
- FFmpeg and ffprobe on `PATH`

## Setup

```bash
cp .env.example .env
# set DATABASE_URL and TEST_DATABASE_URL
pnpm install
pnpm db:migrate
pnpm py:sync
```

## Model providers

Every model capability (vision, LLM, embeddings) runs either on the deterministic
`fixture` provider or on a real model through the Vercel AI Gateway. Which one is
in use is part of the project's diagnostics: `GET /v1/health` and
`GET /v1/projects/:id` return `providers`, and `pnpm cli project inspect` prints
a `providers:` line, so a simulated analysis is never mistaken for a real one.

- `PROVIDER_MODE=demo` (default) allows fixtures. `PROVIDER_MODE=production`
  refuses to build a worker whose capability is still a fixture
  (`CAPABILITY_NOT_READY`).
- `VISION_PROVIDER=gateway` + `VISION_MODEL=<creator/model>` analyzes scene
  frames with a multimodal model. Frame paths are resolved against the repo
  root, so the API may run from `apps/api` (`pnpm studio`).
- `LLM_PROVIDER=gateway` + `LLM_MODEL=<creator/model>` drives moment
  suggestion, narrative analysis and the Director. Provenance records the model:
  `extractorVersion` / `directorVersion` are `1.0.0/<creator/model>`.
- `EMBEDDING_PROVIDER=gateway` + `EMBEDDING_MODEL=<creator/model>` embeds
  moments and feedback. The request pins the catalog's vector width (384), and
  the vector space id (`model@384d/unit`) is stored as `modelVersion`, so
  searches never mix spaces. Changing the embedding model requires re-indexing:
  `pnpm cli asset reprocess <id> --from embeddings` per asset.
- `AI_GATEWAY_API_KEY` is required whenever any capability uses the gateway.

## Jobs, generations, and recovery

Every command that (re)starts a pipeline — `project create`, `generate`,
`render`, `reprocess`, `asset add`, `asset reprocess` — runs under a per-entity
lock and starts a new **generation**. Jobs carry the generation id and a step
key; `TIMING`, `EFFECTS` and `RENDER` also carry the timeline (and, for render,
edit window) version they must consume, pinned when they were enqueued, so an
edit that lands before the job is claimed cannot change its input. Old jobs are
never deleted: PENDING ones of the superseded stages become `CANCELLED`,
COMPLETED ones stay as history, and a command refuses (`409 PROJECT_BUSY` /
`ASSET_BUSY`) while a stage job is RUNNING.

A claimed job holds a lease (60 s, renewed by heartbeat). A worker publishes its
result in one transaction that locks the entity, verifies it still holds the
lease and that its generation is still the active one, writes the domain rows
and follow-up jobs, marks the job COMPLETED and evaluates fan-in barriers. An
attempt that lost its lease publishes nothing (`LEASE_LOST`); one whose
generation was superseded ends `CANCELLED`. The renderer additionally moves the
validated MP4 to its version-named path inside that transaction, so a `renders`
row never points at a missing file; stale `attempt-*` directories are swept
before each render.

Recovery: the API reconciles at startup and then every
`JOB_MAINTENANCE_INTERVAL_MS` (30 s): RUNNING jobs whose lease expired are
reclaimed by the next drain (attempts left) or finalized as
`FAILED/LEASE_EXPIRED` (attempts exhausted), and the owning project/asset is
marked FAILED only when its generation is still current. `pnpm cli worker run`
does the same once.

Clip swaps accept `expectedTimelineVersion`; a swap decided against an older
version is refused with `409 VERSION_CONFLICT` instead of dropping another
editor's change. The swap, its feedback events and their embedding jobs commit
together.

### Upgrading a database that predates leases/generations

Migration `0015` is additive plus a backfill. Deploy in this order: stop every
worker and API process (old attempts cannot be trusted to hold a lease), run
`pnpm db:migrate` (RUNNING jobs without a lease are given an expired one,
coordination rows are seeded from history, existing moment ids are registered
as stable identities), then start the updated API/workers — their startup
reconcile finalizes exhausted jobs and the maintenance drain resumes the rest.
Never delete jobs, feedback or timelines to satisfy the new indexes.

Start Studio (API on `:8787`, web on `:3000`). The web UI is in Portuguese: **Projetos** (home, editor per project) and **Biblioteca** (asset catalog). The editor plays the latest render when it matches the timeline; otherwise it plays a storyboard (the project's music plus one thumbnail per clip) so cuts can be reviewed before rendering. Scrub on the strip or the slider, click a clip to inspect it, and swap candidates from the inspector.

```bash
pnpm studio
```

CLI entry point:

```bash
pnpm cli --help
```

## Catalog and project commands

```bash
pnpm cli asset add ./videos/clip.mp4
pnpm cli asset list
pnpm cli asset inspect ast_...

pnpm cli project create ./music/song.mp3 --lyrics ./music/song.lrc
pnpm cli project inspect prj_...
pnpm cli project generate prj_...
pnpm cli project render prj_...
pnpm cli project reprocess prj_... --from narrative
```

`project create` stops at `TIMELINE_READY`. Render is an explicit second step.

## Output window

- Tracks of **60,000 ms or less** use the full source.
- Longer tracks select one continuous, deterministic **60,000 ms** window (`structural-highlight` v1.0.0).
- The timeline clock always starts at zero. Audio trim uses the absolute source range.

## Continuous coverage

Narrative planning covers the whole window, including instrumental gaps. The Director resolves every span into usable clips. Shared cuts snap to beats without opening gaps. Source duration always equals the slot duration.

If the catalog cannot cover a minimum visual slot, the pipeline stops with `INSUFFICIENT_CATALOG` instead of rendering black, freeze-frames, or loops. Add more or longer source videos and reprocess from narrative.

## Feedback and editorial memory

Every swap, rating, ban, and note is an append-only row in `feedback_events`. Nothing is overwritten and nothing references catalog rows by foreign key, so the memory survives reprocessing.

- Swapping a clip records `SWAP_OUT` for the removed moment and `SWAP_IN` for the new one, with the segment context, and enqueues `FEEDBACK_EMBED` so both become vectors in `moment_feedback_embeddings`.
- Rate the latest timeline (1 to 5), thumb a clip up or down, ban a moment or an asset, or leave an editorial note from Studio, the API, or the CLI:

```bash
pnpm cli feedback rate prj_... 4
pnpm cli feedback clip prj_... clp_... --down
pnpm cli feedback note "shorter cuts on the drop" [--project prj_...]
pnpm cli feedback list [--project prj_...]
pnpm cli moment ban mom_... --note "blurry"
pnpm cli asset ban ast_...
```

What the pipeline does with it:

- `MATCH` (ranker `2.0.0`) excludes banned moments and assets in SQL, never offers a moment swapped out of the same segment again, searches the feedback vectors alongside the catalog, and scores usage from smoothed win rates (overall and per narrative function) with a cross-project novelty term. The newest event considered is stored as `feedback_cutoff_at`.
- `EFFECTS` records one `PLACED` event per clip when the project reaches `TIMELINE_READY`.
- `DIRECTOR` (prompt `v4`) receives `memory`: templated lessons about the shortlisted moments, the editor's notes, and up to three examples of past choices for similar segments. The fixture provider ignores it; the gateway provider includes it in the prompt.
- `DIRECTOR` also proposes a cut style per segment (see [Cut styles](#cut-styles)). The fixture provider proposes none; `LLM_PROVIDER=fixture LLM_MODEL=styled` makes it walk the whole vocabulary by segment position, which is how the resolver and renderer are exercised end to end.

Measure whether the ranker would have agreed with past decisions, using only the feedback that existed before each one:

```bash
pnpm cli eval ranker [--json]
```

The report (top-1, top-3, MRR for chosen moments; rejected-still-first rate) is also written to `storage/cache/eval/`.

## Render

The renderer rejects empty, gapped, source-short timelines, a timeline whose duration disagrees with the selected edit window, and transitions the time model below cannot honor. Video segments join with `concat` for hard cuts and fades and with `xfade` for crossfades and whips; audio is one track with `atrim` + `asetpts=PTS-STARTPTS` and fades only when the selected window does not start at 0 or does not reach the end of the track. Output is 1080×1920@30 h264/aac. `render.json` records wall-time metrics (`validationMs`, `graphBuildMs`, `ffmpegMs`, `probeMs`, clip count, unique sources).

## Cut styles

The Director picks, per segment, how its main clip is styled and how the segment cuts into the next one, from a closed vocabulary (`docs/superpowers/specs/2026-09-01-cut-styles-design.md`). The `EFFECTS` worker resolves every proposal against the real source material and downgrades what cannot render, recording why on the clip (`transitionOut.downgradeReason`) and in `effects.json` (`cuts`). Durations come from the song's tempo, never from the model.

| Transition | Renders as | Needs |
| --- | --- | --- |
| `hard` | `concat` | nothing; default and universal fallback |
| `dip_black` / `flash` | `fade` out on A, `fade` in on B, through black or white | nothing |
| `crossfade` / `whip` | `xfade=fade` / `xfade=slideleft` | `D/2` of spare source on each side of the boundary, inside the moment |

| Clip style | Renders as | Needs |
| --- | --- | --- |
| `hold` | last frame frozen with `tpad=stop_mode=clone` | at least 300 ms of motion left in the slot |
| `speed_up` | `setpts=PTS/1.25` | `slot × 0.25` of spare source after the clip |
| `slow_down` | `setpts=PTS/0.8` | nothing |

Time model: slots stay contiguous and never overlap. A transition is metadata on the boundary, centered on it; each side extends its rendered segment by half the duration (a *handle*), and `xfade` consumes exactly that much, so the output length never changes. Every transition is capped at a third of the smaller neighboring slot.

Downgrades: `crossfade` → `dip_black` → `hard`; `whip` → `hard`; `flash` and `dip_black` shrink to their minimum, then `hard`; `hold` shrinks, then none; `speed_up` → none. A swap in the Studio re-resolves the whole timeline so a new moment never leaves a transition without a handle. The Studio shows the resolved style on the strip and in the Inspector; editing it by hand is a later increment.

## Tests

```bash
pnpm exec vitest run
pnpm py:test
pnpm typecheck
pnpm lint
pnpm --filter @memetize/web build
```

Integration and E2E suites need `TEST_DATABASE_URL` plus FFmpeg and the Python worker virtualenvs (`docker compose up -d db` provides PostgreSQL+pgvector on `:5433`; create `memetize_test` next to `memetize`). Without those, the suites skip under plain `pnpm test` — they are not a pass. The gate is:

```bash
pnpm test:integration   # REQUIRE_INTEGRATION_TESTS=1: a missing or broken TEST_DATABASE_URL fails the run
```

CI runs it in `.github/workflows/integration.yml` with a real database, FFmpeg and the Python virtualenvs. Locally, FFmpeg- and Python-dependent suites still skip when those tools are absent; only the database is mandatory.
