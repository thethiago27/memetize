/**
 * Prompts are versioned like code (spec section 46): a prompt is never edited
 * in place, a new version is added instead so past results stay reproducible.
 */

export const VISION_PROMPT_VERSION = 'v1';

export const VISION_PROMPT_V1 = `You are analyzing one scene from a short video that may be reused as a meme clip.

Given the sampled frames (in order) and any speech transcript for this time range, describe the scene at two levels:

1. Objective description: what is literally happening (subjects, actions, camera).
2. Editorial interpretation: how this moment could function as a meme (the emotional beat, the "meme function").

Respond with structured JSON matching the required schema. Do not include any text outside the JSON.`;
