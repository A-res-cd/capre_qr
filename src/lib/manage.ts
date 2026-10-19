import { auth } from '@/auth';
import { staffActor } from './access';
import { db } from './db';
import { HttpError } from './codes';
export async function requireStaff(request: Request) {
  const actor = staffActor(await auth());
  if (!actor) throw new HttpError(401, 'Authorized staff sign-in required.');
  if (!['GET', 'HEAD'].includes(request.method)) {
    const expected = new URL(process.env.AUTH_URL || request.url).origin;
    if (request.headers.get('origin') !== expected) throw new HttpError(403, 'Request origin rejected.');
  }
  const window = new Date(Math.floor(Date.now() / 60000) * 60000);
  const key = `${actor}:${window.toISOString()}`;
  const rate = await db.rateLimit.upsert({ where: { key }, create: { key, window }, update: { count: { increment: 1 } } });
  if (rate.count > 240) throw new HttpError(429, 'Too many management requests. Try again in one minute.');
  return actor;
}
export async function readJson(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  // Stream cap also handles chunked requests; Content-Length is not trusted.
  const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, 'Request body required.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 800000) { await reader.cancel(); throw new HttpError(413, 'Request too large. Logo limit: 500 KB.'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON.'); }
}
