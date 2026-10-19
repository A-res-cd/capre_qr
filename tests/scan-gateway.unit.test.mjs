import { afterAll, beforeAll, expect, it } from 'vitest';
import http from 'node:http';
import { createScanGateway } from '../scripts/scan-gateway.mjs';
let backend, gateway, base;
const seen = [];
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
beforeAll(async () => {
  backend = http.createServer((req, res) => {
    seen.push({ path: req.url, headers: req.headers, method: req.method });
    if (req.url === '/PausedCode12') { res.writeHead(503, { 'Content-Type': 'text/html', 'Retry-After': '3600' }); res.end('Paused'); }
    else { res.writeHead(302, { Location: 'https://example.org/destination', 'Cache-Control': 'no-store', 'Set-Cookie': 'unexpected=secret' }); res.end(); }
  });
  await listen(backend);
  gateway = createScanGateway(new URL(`http://127.0.0.1:${backend.address().port}`)); await listen(gateway);
  base = `http://127.0.0.1:${gateway.address().port}`;
});
afterAll(async () => { await Promise.all([new Promise(r => gateway.close(r)), new Promise(r => backend.close(r))]); });
it('blocks dashboard, OAuth, APIs, and writes before they reach the app', async () => {
  const before = seen.length;
  for (const path of ['/dashboard', '/signin', '/api/auth/session', '/api/manage/codes', '/api/health', '/__capreqr_stop']) expect((await fetch(base + path)).status).toBe(404);
  expect((await fetch(base + '/ActiveCode12', { method: 'POST', body: '{}' })).status).toBe(405);
  expect(seen.length).toBe(before);
});
it('preserves active redirects and strips identifying headers and cookies', async () => {
  const response = await fetch(base + '/ActiveCode12?private=secret', { redirect: 'manual', headers: { cookie: 'staff=secret', authorization: 'Bearer secret', 'x-forwarded-for': '192.0.2.1', referer: 'https://private.example', 'user-agent': 'Mobile Safari' } });
  expect(response.status).toBe(302); expect(response.headers.get('location')).toBe('https://example.org/destination'); expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.get('set-cookie')).toBeNull();
  const request = seen.at(-1); expect(request.path).toBe('/ActiveCode12'); expect(request.headers['user-agent']).toBe('Mobile Safari');
  for (const header of ['cookie', 'authorization', 'x-forwarded-for', 'referer']) expect(request.headers[header]).toBeUndefined();
});
it('preserves paused responses and HEAD without an interstitial', async () => {
  const paused = await fetch(base + '/PausedCode12'); expect(paused.status).toBe(503); expect(await paused.text()).toBe('Paused'); expect(paused.headers.get('retry-after')).toBe('3600');
  const head = await fetch(base + '/ActiveCode12', { method: 'HEAD', redirect: 'manual' }); expect(head.status).toBe(302); expect(await head.text()).toBe(''); expect(seen.at(-1).method).toBe('HEAD');
});
