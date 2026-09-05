/**
 * The storyboard plays the project's music while the strip shows one
 * thumbnail per clip (editor-transport spec). The music file runs on the
 * song's clock; the editor runs on the output clock. The timeline document
 * records how the two line up, so both conversions are one addition.
 */
export interface StoryboardAudio {
  /** Output ms where the audio starts (always 0 today). */
  timelineStartMs: number;
  /** Song ms that plays at `timelineStartMs`. */
  sourceStartMs: number;
}

export function outputToSourceMs(outputMs: number, audio: StoryboardAudio): number {
  return outputMs - audio.timelineStartMs + audio.sourceStartMs;
}

export function sourceToOutputMs(sourceMs: number, audio: StoryboardAudio): number {
  return sourceMs - audio.sourceStartMs + audio.timelineStartMs;
}
