import { SwapClipError, type SwapClipErrorCode } from '@memetize/projects';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { sendSwapError } from './errors';

describe('sendSwapError', () => {
  it('returns 409 when the shortlisted moment is too short for the slot', async () => {
    const app = Fastify();
    app.get('/', async (_request, reply) =>
      sendSwapError(
        reply,
        new SwapClipError(
          'MOMENT_TOO_SHORT' as SwapClipErrorCode,
          'moment is shorter than the slot',
        ),
      ),
    );

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: 'MOMENT_TOO_SHORT',
        message: 'moment is shorter than the slot',
      },
    });
    await app.close();
  });
});
