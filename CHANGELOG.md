# Changelog

## Unreleased

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
