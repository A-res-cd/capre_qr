import { deviceCategory, excludedRequest } from './anonymous';
export { deviceCategory, excludedRequest } from './anonymous';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
const timeout = Math.min(500, Math.max(25, Number(process.env.ANALYTICS_ENQUEUE_TIMEOUT_MS) || 150));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4, connectionTimeoutMillis: timeout, statement_timeout: timeout, query_timeout: timeout, idleTimeoutMillis: 10000, allowExitOnIdle: true });
pool.on('error', () => console.warn('analytics_pool_unavailable'));
export type AnonymousEvent = { id: string; qrId: string; occurredAt: Date; device: string; outcome: 'redirect' | 'paused' };
export async function enqueue(qrId: string, headers: Headers, outcome: 'redirect' | 'paused') {
  if (excludedRequest(headers)) return;
  // No raw headers, IPs, or identities leave this function.
  const event: AnonymousEvent = { id: randomUUID(), qrId, occurredAt: new Date(), device: deviceCategory(headers.get('user-agent') || ''), outcome };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const insert = pool.query('INSERT INTO "PendingScan" (id,"qrId","occurredAt",device,outcome) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [event.id, event.qrId, event.occurredAt, event.device, event.outcome]).catch(() => console.warn('analytics_enqueue_failed'));
  await Promise.race([insert, new Promise<void>(resolve => { timer = setTimeout(() => { console.warn('analytics_enqueue_timeout'); resolve(); }, timeout); })]);
  if (timer) clearTimeout(timer);
}
