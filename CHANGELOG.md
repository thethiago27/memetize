# Changelog

## Unreleased

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
