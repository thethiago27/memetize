import type { RenderProfile } from '@memetize/contracts';

export type RenderSourceOrigin = 'original' | 'proxy';

export interface RenderSourceAsset {
  originalPath: string | null;
  proxyPath: string | null;
}

export interface ChosenRenderSource {
  path: string;
  origin: RenderSourceOrigin;
}

/**
 * Picks which stored variant a render reads from (F06). A `final` render must
 * export from the original (full-resolution) asset, never from the 720p preview
 * proxy or the 480p analysis copy — upscaling a 404×720 proxy back to 1080×1920
 * throws away detail. Only a `preview` render may use the proxy. A `final` render
 * whose original is gone fails loudly rather than silently degrading.
 */
export function chooseRenderSource(
  asset: RenderSourceAsset,
  profile: RenderProfile,
): ChosenRenderSource {
  if (profile === 'preview' && asset.proxyPath) {
    return { path: asset.proxyPath, origin: 'proxy' };
  }
  if (!asset.originalPath) {
    throw new Error('ORIGINAL_NOT_AVAILABLE');
  }
  return { path: asset.originalPath, origin: 'original' };
}
