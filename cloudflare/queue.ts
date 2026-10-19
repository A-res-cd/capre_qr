import type { Env, Context } from './types';
import { deviceCategory, excludedRequest } from '../src/lib/anonymous';
export async function processPending(env: Env) {
  const results = await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO ProcessedEvent(id) SELECT id FROM PendingScan ORDER BY queuedAt LIMIT 50'),
    env.DB.prepare('DELETE FROM PendingScan WHERE id IN (SELECT p.id FROM PendingScan p JOIN ProcessedEvent r ON r.id=p.id LIMIT 50)'),
  ]);
  return results[0].meta.changes;
}
export async function enqueue(env: Env, ctx: Context, qrId: string, headers: Headers, outcome: 'redirect' | 'paused') {
  if (excludedRequest(headers)) return;
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const write = env.DB.prepare('INSERT OR IGNORE INTO PendingScan(id,qrId,occurredAt,device,outcome,queuedAt) VALUES (?,?,?,?,?,?)').bind(id, qrId, now, deviceCategory(headers.get('user-agent') || ''), outcome, now).run();
  const safe = write.catch(() => { console.warn('analytics_enqueue_failed'); });
  // Keep a late database operation alive without holding the public response open.
  ctx.waitUntil(safe);
  const timeout = Math.min(500, Math.max(25, Number(env.ANALYTICS_ENQUEUE_TIMEOUT_MS) || 150));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([safe, new Promise<void>(resolve => { timer = setTimeout(() => { console.warn('analytics_enqueue_timeout'); resolve(); }, timeout); })]);
  if (timer) clearTimeout(timer);
}
export async function scheduledAnalytics(env: Env, scheduledTime: number) {
  await processPending(env);
  if (new Date(scheduledTime).getUTCMinutes() !== 0) return;
  const row = await env.DB.prepare('SELECT retentionDays FROM OrganizationSettings WHERE id=1').first<{retentionDays:number}>();
  const cutoff = new Date(scheduledTime - (row?.retentionDays || 90) * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ScanEvent WHERE id IN (SELECT id FROM ScanEvent WHERE occurredAt<? LIMIT 10000)').bind(cutoff),
    env.DB.prepare('DELETE FROM RateLimit WHERE key IN (SELECT key FROM RateLimit WHERE window<? LIMIT 10000)').bind(new Date(scheduledTime - 86400000).toISOString()),
  ]);
}
