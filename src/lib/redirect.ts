import { db } from './db';
import { enqueue } from './queue';
import { getSettings } from './settings';
const noCache = { 'Cache-Control': 'private, no-store, no-cache, max-age=0, must-revalidate', 'CDN-Cache-Control': 'no-store', 'Surrogate-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' };
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
export async function resolveRedirect(request: Request, shortCode: string, head = false) {
  if (!/^[A-Za-z0-9_-]{12}$/.test(shortCode)) return new Response('QR link not found.', { status: 404, headers: noCache });
  try {
    const code = await db.qRCode.findUnique({ where: { shortCode }, select: { id: true, destination: true, status: true } });
    if (!code) return new Response('QR link not found.', { status: 404, headers: noCache });
    if (!head) {
      try { await enqueue(code.id, request.headers, code.status === 'ACTIVE' ? 'redirect' : 'paused'); }
      catch { console.warn('analytics_submission_failed'); }
    }
    if (code.status === 'ACTIVE') return new Response(null, { status: 302, headers: { ...noCache, Location: code.destination } });
    const settings = await getSettings();
    const html = `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link unavailable</title><body style="font-family:Segoe UI,system-ui,sans-serif;background:#faf9f4;color:#333333;padding:10vh 24px;text-align:center"><main><p style="color:${settings.accent}">${escapeHtml(settings.name)}</p><h1 style="font-family:Georgia,serif;color:#2e3f92">This link is temporarily unavailable.</h1><p>Please check back later or contact the organization that shared this QR code.</p></main></body></html>`;
    return new Response(head ? null : html, { status: 503, headers: { ...noCache, 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '3600', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" } });
  } catch {
    console.error('qr_resolution_failed');
    return new Response('QR service temporarily unavailable. Please try again.', { status: 503, headers: noCache });
  }
}
