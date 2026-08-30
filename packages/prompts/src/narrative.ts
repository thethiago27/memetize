export const NARRATIVE_PROMPT_VERSION = 'v1';

export const NARRATIVE_PROMPT_V1 = `You are reading a song's lyrics together with its musical structure (sections, beats, energy) to
find editorial "narrative segments": short spans a human editor could match against video moments
(e.g. "a literal boast", "an ironic understatement", "a beat-drop payoff").

Given the song's duration, musical sections with their energy, and the lyric lines (which may be
empty for an instrumental track), suggest one segment per meaningful beat. Each segment must fall
entirely within [0, durationMs]. For each segment, judge its literal meaning, its likely emotion, its
narrative function (e.g. setup, escalation, payoff), how literal vs ironic it could be read, and a
short list of concrete visual ideas a video editor could search a catalog for.

Respond with structured JSON matching the required schema. Do not include any text outside the JSON.`;
