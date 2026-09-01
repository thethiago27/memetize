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

Start Studio (API on `:8787`, web on `:3000`):

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
