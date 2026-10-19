import type { Env } from './types';
import { HttpError } from '../src/lib/errors';
import { organizationAccent } from '../src/lib/brand';
export { HttpError };
export const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };
export function json(data: unknown, status = 200, extra: Record<string,string> = {}) { return Response.json(data, { status, headers: { ...privateHeaders, ...extra } }); }
export function originFor(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpError(503, 'Public URL is not configured.'); }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new HttpError(503, 'Configure a plain HTTPS origin (HTTP is allowed on loopback for local testing).');
  return url.origin;
}
export function link(env: Env, code: string) { return `${originFor(env.QR_BASE_URL)}/${code}`; }
export function assertOrigin(request: Request, env: Env) {
  if (request.headers.get('origin') !== originFor(env.AUTH_URL)) throw new HttpError(403, 'Request origin rejected.');
}
export async function readJson(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, 'Request body required.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 800000) { await reader.cancel(); throw new HttpError(413, 'Request too large.'); } chunks.push(value); }
  const all = new Uint8Array(size); let offset = 0; for (const c of chunks) { all.set(c, offset); offset += c.length; }
  try { return JSON.parse(new TextDecoder().decode(all)); } catch { throw new HttpError(400, 'Invalid JSON.'); }
}
export async function settings(env: Env) {
  let row = await env.DB.prepare('SELECT * FROM OrganizationSettings WHERE id=1').first<{ id:number; name:string; timezone:string; retentionDays:number; accent:string }>();
  if (!row) {
    const timezone = env.REPORTING_TIMEZONE || 'Asia/Manila';
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    const days = Number(env.ANALYTICS_RETENTION_DAYS || 90);
    if (!Number.isInteger(days) || days < 1 || days > 3650) throw new HttpError(503, 'Configure analytics retention between 1 and 3650 days.');
    await env.DB.prepare('INSERT OR IGNORE INTO OrganizationSettings(id,name,timezone,retentionDays,accent) VALUES (1,?,?,?,?)').bind('Our organization', timezone, days, '#2e3f92').run();
    row = await env.DB.prepare('SELECT * FROM OrganizationSettings WHERE id=1').first();
  }
  if (!row) throw new HttpError(503, 'Organization settings unavailable.');
  return { ...row, accent: organizationAccent(row.accent) };
}
