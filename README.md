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

Integration and E2E suites need `TEST_DATABASE_URL` plus FFmpeg and the Python worker virtualenvs. Without those, the suites skip — they are not a pass.
