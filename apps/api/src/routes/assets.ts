import { AssetReprocessFrom, ExclusionInput, ReprocessBody } from '@memetize/contracts';
import { excludeRange, includeRange, listActiveBans } from '@memetize/feedback';
import {
  getAsset,
  ingestAsset,
  listAssets,
  listMoments,
  listScenes,
  reprocessAsset,
} from '@memetize/media-catalog';
import type { AppRuntime } from '@memetize/runtime';
import type { FastifyInstance } from 'fastify';
import { kickDrain } from '../drain';
import { sendError } from '../errors';
import { removeUpload, saveUpload } from '../upload';

export function registerAssetRoutes(app: FastifyInstance, runtime: AppRuntime): void {
  app.get('/v1/assets', async () => {
    return { assets: await listAssets(runtime.db) };
  });

  app.get('/v1/assets/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const asset = await getAsset(runtime.db, id);
    if (!asset) return sendError(reply, 404, 'NOT_FOUND', `asset not found: ${id}`);
    const [scenes, moments, bans] = await Promise.all([
      listScenes(runtime.db, id),
      listMoments(runtime.db, id),
      listActiveBans(runtime.db),
    ]);
    return {
      asset,
      scenes,
      moments: moments.map((moment) => ({ ...moment, banned: bans.momentIds.has(moment.id) })),
      banned: bans.assetIds.has(id),
      exclusions: bans.excludedRanges.get(id) ?? [],
    };
  });

  app.get('/v1/assets/:id/scenes', async (request, reply) => {
    const { id } = request.params as { id: string };
    const asset = await getAsset(runtime.db, id);
    if (!asset) return sendError(reply, 404, 'NOT_FOUND', `asset not found: ${id}`);
    return { scenes: await listScenes(runtime.db, id) };
  });

  app.get('/v1/assets/:id/moments', async (request, reply) => {
    const { id } = request.params as { id: string };
    const asset = await getAsset(runtime.db, id);
    if (!asset) return sendError(reply, 404, 'NOT_FOUND', `asset not found: ${id}`);
    return { moments: await listMoments(runtime.db, id) };
  });

  app.post('/v1/assets', async (request, reply) => {
    const file = await request.file();
    if (!file) return sendError(reply, 400, 'NO_FILE', 'expected a video file field');
    const saved = await saveUpload(file);
    try {
      const sourceField = file.fields.source;
      const source = sourceField && 'value' in sourceField ? String(sourceField.value) : undefined;
      const { asset, created } = await ingestAsset({
        db: runtime.db,
        config: runtime.config,
        filePath: saved.path,
        source,
        displayName: saved.originalName,
      });
      kickDrain(runtime, asset.id);
      return reply.status(created ? 201 : 200).send({ asset, created });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return sendError(reply, 400, 'INGEST_FAILED', message);
    } finally {
      await removeUpload(saved.path);
    }
  });

  app.post('/v1/assets/:id/reprocess', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ReprocessBody.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_INPUT', parsed.error.message);
    const from = AssetReprocessFrom.safeParse(parsed.data.from);
    if (!from.success) return sendError(reply, 400, 'INVALID_INPUT', from.error.message);
    const asset = await getAsset(runtime.db, id);
    if (!asset) return sendError(reply, 404, 'NOT_FOUND', `asset not found: ${id}`);
    await reprocessAsset(runtime.db, id, from.data);
    kickDrain(runtime, id);
    return { ok: true, from: from.data };
  });

  app.post('/v1/assets/:id/exclusions', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ExclusionInput.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_INPUT', parsed.error.message);
    const asset = await getAsset(runtime.db, id);
    if (!asset) return sendError(reply, 404, 'NOT_FOUND', `asset not found: ${id}`);
    const event = await excludeRange(runtime.db, {
      assetId: id,
      startMs: parsed.data.startMs,
      endMs: parsed.data.endMs,
      note: parsed.data.note ?? null,
    });
    return reply.status(201).send({ event });
  });

  app.delete('/v1/assets/:id/exclusions', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = ExclusionInput.safeParse(request.body);
    if (!parsed.success) return sendError(reply, 400, 'INVALID_INPUT', parsed.error.message);
    const asset = await getAsset(runtime.db, id);
    if (!asset) return sendError(reply, 404, 'NOT_FOUND', `asset not found: ${id}`);
    const event = await includeRange(runtime.db, {
      assetId: id,
      startMs: parsed.data.startMs,
      endMs: parsed.data.endMs,
    });
    return { event };
  });
}
