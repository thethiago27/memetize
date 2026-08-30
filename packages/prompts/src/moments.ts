export const MOMENTS_PROMPT_VERSION = 'v1';

export const MOMENTS_PROMPT_V1 = `You are splitting one video scene into editorial "moments": short beats a human editor
would treat as separate units (e.g. "serious setup", "realization", "trying not to laugh").

Given the scene's structured vision analysis and any overlapping speech transcript, suggest one or
more moments that partition the scene's time range. Each moment must fall entirely within the
scene's start/end bounds. Prefer the smallest set of moments that captures distinct emotional beats;
a single moment covering the whole scene is fine when nothing changes within it.

Respond with structured JSON matching the required schema. Do not include any text outside the JSON.`;
