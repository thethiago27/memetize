import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { Database } from '@memetize/database';
import { type AppConfig, ensureDir } from '@memetize/shared';
import { getAsset } from './assets';
import { getMoment } from './moments';
import { momentExportFile, resolveStorage, type StoragePath } from './paths';

const execFileAsync = promisify(execFile);

/**
 * Cuts a moment's `[startMs, endMs]` window out of the asset's proxy
 * (falling back to the analysis clip) into `storage/temp/{momentId}.mp4`
 * (spec section 75). Read-only against the catalog: no job is enqueued, the
 * CLI never processes media directly (spec section principles).
 */
export async function exportMoment(
  db: Database,
  config: AppConfig,
  momentId: string,
): Promise<StoragePath> {
  const moment = await getMoment(db, momentId);
  if (!moment) throw new Error(`moment not found: ${momentId}`);

  const asset = await getAsset(db, moment.assetId);
  if (!asset) throw new Error(`asset not found: ${moment.assetId}`);

  const sourceRelative = asset.proxyPath ?? asset.analysisPath;
  if (!sourceRelative) {
    throw new Error(`asset ${asset.id} has no proxy or analysis clip to export from`);
  }
  const sourcePath = resolveStorage(config, sourceRelative);
  const output = momentExportFile(config, momentId);
  await ensureDir(dirname(output.absolute));

  await execFileAsync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    (moment.startMs / 1000).toFixed(3),
    '-i',
    sourcePath,
    '-t',
    ((moment.endMs - moment.startMs) / 1000).toFixed(3),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    output.absolute,
  ]);

  return output;
}
