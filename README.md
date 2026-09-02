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

Start Studio (API on `:8787`, web on `:3000`). The web UI is in Portuguese: **Projetos** (home, editor per project) and **Biblioteca** (asset catalog).

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
- `DIRECTOR` (prompt `v3`) receives `memory`: templated lessons about the shortlisted moments, the editor's notes, and up to three examples of past choices for similar segments. The fixture provider ignores it; the gateway provider includes it in the prompt.

Measure whether the ranker would have agreed with past decisions, using only the feedback that existed before each one:

```bash
pnpm cli eval ranker [--json]
```

The report (top-1, top-3, MRR for chosen moments; rejected-still-first rate) is also written to `storage/cache/eval/`.

## Render

The renderer rejects empty, gapped, or source-short timelines. The FFmpeg graph uses hard cuts, `atrim` + `asetpts=PTS-STARTPTS`, and fades only when the selected window does not start at 0 or does not reach the end of the track. Output is 1080×1920@30 h264/aac. `render.json` records wall-time metrics (`validationMs`, `graphBuildMs`, `ffmpegMs`, `probeMs`, clip count, unique sources).

## Tests

```bash
pnpm exec vitest run
pnpm py:test
pnpm typecheck
pnpm lint
pnpm --filter @memetize/web build
```

Integration and E2E suites need `TEST_DATABASE_URL` plus FFmpeg and the Python worker virtualenvs. Without those, the suites skip — they are not a pass.
