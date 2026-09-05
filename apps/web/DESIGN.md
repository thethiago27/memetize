---
name: Memetize Studio
description: Local AI meme-video editor — graphite bay, one coral mark for the cut.
colors:
  signal: "#ff4d6d"
  signal-ink: "#1a0610"
  cut: "#ff6b4a"
  ok: "#3dce8e"
  bay: "#0b0d12"
  well: "#07080c"
  panel: "#141822"
  panel-2: "#1b2130"
  rule: "#2c3345"
  ink: "#eef1f8"
  tape: "#c4c9d6"
  mute: "#8b93a7"
  fn-setup: "#5b8def"
  fn-escalation: "#f0a04b"
  fn-payoff: "#e24b7a"
  fn-other: "#7d8899"
typography:
  display:
    fontFamily: "Outfit, sans-serif"
    fontSize: "clamp(1.8rem, 3vw, 2.6rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Outfit, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Outfit, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Outfit, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Outfit, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 600
    lineHeight: 1.2
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "4px"
  md: "8px"
  screen: "12px"
  pill: "999px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.md}"
    padding: "7px 14px"
  button-primary-hover:
    backgroundColor: "#ff6e88"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.md}"
    padding: "7px 14px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.signal}"
    rounded: "{rounded.md}"
    padding: "7px 14px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.tape}"
    rounded: "{rounded.md}"
    padding: "7px 14px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.cut}"
    rounded: "{rounded.md}"
    padding: "7px 14px"
  input:
    backgroundColor: "{colors.bay}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
  pill:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.tape}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px"
  nav-active:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
---

# Design System: Memetize Studio

## 1. Overview

**Creative North Star: "The Afterglow Bay"**

Studio is a night bay: cool graphite, dense but quiet, one coral mark for where you are. You sit in it to review a planned cut, not to decorate a room. The surface is the work — a 9:16 screen, a strip, a playhead — and the chrome stays off that object.

Personality is calm, precise, technical. Outfit carries every label in Portuguese. IBM Plex Mono is reserved for time, versions, and ids. Numbers appear when they earn their place. There is no performance around the cut.

This system explicitly rejects Premiere and DaVinci Resolve's professional cockpit of four hundred panels. Steal the strip and the clock from Resolve; do not steal the rest of the room.

**Key Characteristics:**
- Graphite bay, not cinema black and not SaaS navy
- Afterglow coral used as a mark, never as a wash
- One strip, one clock; preview and playhead agree
- 1px rules for depth; no drop shadows
- Outline until the one primary fills

## 2. Colors

Cool graphite night with one coral residue after the cut.

### Primary
- **Afterglow coral** (`{colors.signal}`): Primary actions, playhead, current selection, focus ring, the lit lyric. The mark that means *this is the cut*. Rarity is the point.

### Secondary
- **Cut orange** (`{colors.cut}`): Danger and failure only — delete, ban, failed jobs, error copy. Never used as a second brand accent.

### Tertiary
Omit as brand. The four narrative hues are data, documented under Named Rules.

### Neutral
- **Graphite bay** (`{colors.bay}`): Page background. The room.
- **Well** (`{colors.well}`): The hole the preview and strip sit in. Darker than the bay, always.
- **Panel** (`{colors.panel}`): Mast, cards, inspector, dialogs.
- **Panel 2** (`{colors.panel-2}`): Recessed chips, hover wells, toast bodies, active nav.
- **Rule** (`{colors.rule}`): The only edge. 1px borders and dividers.
- **Ink** (`{colors.ink}`): Body text, titles, selected nav.
- **Tape** (`{colors.tape}`): Secondary copy, section titles, ledes. Not body.
- **Mute** (`{colors.mute}`): Idle nav, empty hints, ticks. Never long-form text.
- **Signal ink** (`{colors.signal-ink}`): Text on a filled Afterglow button only.
- **Ok** (`{colors.ok}`): Completed pipeline, live API lamp. Status, not decoration.

### Named Rules
**The Afterglow Rule.** Afterglow coral occupies ≤10% of any screen. It is the playhead, the filled primary, the selected clip ring, and the focus outline. If a panel is tinted coral, the mark is spent.

**The Narrative is Data Rule.** Setup (`{colors.fn-setup}`), escalation (`{colors.fn-escalation}`), payoff (`{colors.fn-payoff}`), and other (`{colors.fn-other}`) color clip bars and the legend only. They are never buttons, never wordmarks, never backgrounds.

**The Ink Rule.** Body and labels that must be read sit on ink or tape. Mute is for idle chrome. If a sentence is mute-on-bay, bump it to tape.

## 3. Typography

**Display Font:** Outfit (with sans-serif)
**Body Font:** Outfit (with sans-serif)
**Label/Mono Font:** IBM Plex Mono (with ui-monospace)

**Character:** One geometric sans for the whole UI; a tabular mono for the clock. No second display face. The pairing is an instrument, not a poster.

### Hierarchy
- **Display** (700, clamp 1.8–2.6rem, line-height 1.1, tracking -0.03em): List-page titles only (`Projetos`, `Biblioteca`). `text-wrap: balance`. Never in the editor chrome.
- **Headline** (700, 1.5rem, line-height 1.1): Editor project title. Truncates; does not wrap the header.
- **Title** (600, 1.05rem, tape): Section headings inside panels. Not uppercase. Not tracked-out eyebrows.
- **Body** (400, 15px, line-height 1.45): UI copy. Ledes cap around 48rem. Dense editor chrome can run tighter.
- **Label** (600, 0.85rem): Field labels, small meta, ghost control text.
- **Mono** (400, 0.8rem): Timecodes, bpm, timeline/render versions, clip labels on the strip, job ids. Tabular nums on the transport clock.

### Named Rules
**The Numbers Rule.** Outfit never carries a timecode. IBM Plex Mono never carries a heading, a button, or a paragraph.

**The No-Eyebrow Rule.** Section titles are sentence-case Outfit at 1.05rem in tape. Forbidden: tiny uppercase tracked kickers above every block.

## 4. Elevation

Flat. Depth is a darker well or a 1px rule, never a drop shadow. The page is bay; panels are one step up in value; the preview and strip drop into the well. Dialogs and toasts are panels with a rule, same as everything else.

`--shadow: 0 10px 30px rgba(0, 0, 0, 0.35)` still exists on dialogs and toasts in code. That is leftover. Do not copy it. Do not pair a 1px border with a wide shadow.

### Shadow Vocabulary
None. The system has no shadow roles.

### Named Rules
**The Rule Rule.** Every edge is `1px solid` `{colors.rule}`. Hover may shift a card's border to Afterglow coral. No 2px+ side stripes. No ambient umbra.

**The Well Rule.** Media lives in `{colors.well}`: the 9:16 screen, the strip track, empty thumbs. Panels never sit in the well; the well never becomes a card.

## 5. Components

Refined and restrained — outline until the one primary fills.

### Buttons
- **Shape:** Gently curved (8px). Never pill. Never 16px+ radius.
- **Primary:** Afterglow coral fill, signal-ink text, padding 7×14, weight 600. One per action cluster (`Renderizar`, `Criar projeto`, `Novo projeto`).
- **Hover / Focus:** Primary hover lightens the fill toward white (~14%). Focus-visible is a 2px Afterglow outline with 2px offset on every control. Disabled is 45% opacity, no pointer.
- **Secondary:** Transparent fill, Afterglow coral stroke and text. Hover tints the fill with ~10% coral.
- **Ghost:** No stroke. Tape text. Hover wells into panel-2.
- **Danger:** Cut orange stroke and text. Hover tints cut at ~12%. Never filled coral-orange.

### Chips
- **Style:** Pill (999px), panel-2 fill, 1px rule, tape text, 2×10 padding, 0.78rem, a 7px status dot.
- **State:** `ok` dot uses ok; `busy` dot uses Afterglow and pulses (1.2s, killed under reduced motion); `bad` uses cut on the border. Narrative chips borrow `fn-*` on the dot only.

### Cards / Containers
- **Corner Style:** 8px
- **Background:** Panel
- **Shadow Strategy:** None. See Elevation.
- **Border:** 1px rule. Hover on a linked card: border becomes Afterglow coral (150ms).
- **Internal Padding:** 12px on cards, 16px on panels and dialogs. Nested cards are forbidden.

### Inputs / Fields
- **Style:** Bay fill inside a panel, 1px rule, 8px radius, 8×10 padding, ink text. Labels are tape, 0.85rem, stacked 6px above.
- **Focus:** 2px Afterglow outline, 2px offset. No glow.
- **Error / Disabled:** Error copy is cut. Disabled follows the 45% opacity rule. Dropzones use a dashed rule; dragging in paints a 6% coral wash and an Afterglow dash.

### Navigation
- **Style:** Sticky mast, 58px, panel fill, 1px rule on the bottom, z-index 5. Wordmark is Outfit 1.5rem / 700; the `tize` in Afterglow coral is the only brand mark on the bar.
- **Default:** Mute, weight 600, 6×10 padding.
- **Active:** Ink on a panel-2 well.
- **Mobile:** Same bar. No hamburger. The editor stacks under 960px: preview, then strip, then inspector.

### Screen (signature)
The 9:16 object of work. Height fits the leftover column (`min(100cqh, 100cqw × 16/9)`), 12px corners, 1px rule, well fill. Under 960px it caps at 320px wide. Storyboard and render share this frame so the clock never changes objects.

### Timeline strip (signature)
Full width, 84px track in the well, 4px clip corners. Each clip is a thumbnail with a 4px narrative-function bar on top and a dark wash toward the label. Selected: 2px Afterglow inset ring. Playing: the wash tints coral. The playhead is a 2px Afterglow line with a 6px triangle handle. Non-hard cuts get a 6px boundary marker; they are data, not decoration.

### Transport
Play/pause, tabular clock, clip name, range slider with Afterglow accent. Same clock as the strip. No second scrubber vocabulary.

### Tabs
Mute labels, 8×14, 2px transparent underline. Active: ink, Afterglow underline. The row sits on a 1px rule. Never pills for editor tabs.

### Dialog
Centered overlay at 60% black. Panel, 1px rule, 24px padding, max 480px. No drop shadow. Overlay z-index 20.

### Toast
Fixed bottom-right, z-index 30, panel-2, 1px rule on all four sides, 10×14 padding. Tone is a full-border shift to ok or cut — never a 3px left stripe. Rise 180ms ease-out; instant under reduced motion.

### Empty / notice
Empty: dashed rule, mute, centered, generous padding. Notice: 1px Afterglow (or cut when `bad`), 6% wash, 8px radius. Copy tells the next action.

## 6. Do's and Don'ts

### Do:
- **Do** keep Afterglow coral for the playhead, the one filled primary, selection, and focus (2px / 2px offset).
- **Do** stack graphite as bay → panel → panel-2, and drop media into the well.
- **Do** draw every edge with a 1px `{colors.rule}` line.
- **Do** put time, versions, and ids in IBM Plex Mono; everything else in Outfit.
- **Do** keep one strip and one clock. Preview and playhead must agree about what you are watching.
- **Do** write every label, empty state, error, and toast in Portuguese.
- **Do** kill animation and transition under `prefers-reduced-motion: reduce`.
- **Do** use narrative hues only on clip bars and the legend.

### Don't:
- **Don't** build Premiere and DaVinci Resolve's professional cockpit of four hundred panels.
- **Don't** steal the rest of the room from Resolve — steal the strip and the clock only.
- **Don't** use drop shadows, including `0 10px 30px rgba(0, 0, 0, 0.35)` on dialogs or toasts.
- **Don't** pair a 1px border with a wide soft shadow.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored stripe (toasts, quotes, selected rows).
- **Don't** wash a panel, page, or card in Afterglow coral.
- **Don't** use narrative-function colors as brand, buttons, or wordmarks.
- **Don't** set body copy in mute (`{colors.mute}`) on bay.
- **Don't** nest cards inside cards.
- **Don't** round surfaces past 12px (the screen). Controls stay at 8px; pills are the only full-round shape.
- **Don't** introduce a second display font, gradient text, or glassmorphism.
- **Don't** add uppercase tracked eyebrows above sections.
- **Don't** animate layout or choreograph page load. Motion is state (busy pulse, toast rise, 150ms border) or it is nothing.
