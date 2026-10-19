import http from 'node:http';

/** A tunnel-facing gateway which exposes only public scan routes. */
export function createScanGateway(localURL) {
  return http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    let pathname;
    try { pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname; }
    catch { res.writeHead(400); res.end('Invalid link.'); return; }
    if (!['GET', 'HEAD'].includes(req.method || '')) { res.writeHead(405); res.end('Method unavailable.'); return; }
    if (pathname === '/') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(req.method === 'HEAD' ? undefined : 'CapreQR scan gateway. Open your QR short link to continue.'); return;
    }
    if (!/^\/[A-Za-z0-9_-]{12}$/.test(pathname)) { res.writeHead(404); res.end('Not found.'); return; }
    const headers = {};
    // Strip IP forwarding, cookies, authorization, referrer, and query strings.
    for (const key of ['user-agent', 'purpose', 'sec-purpose', 'accept']) if (req.headers[key]) headers[key] = req.headers[key];
    const upstream = http.request(new URL(pathname, localURL), { method: req.method, headers, timeout: 6000 }, response => {
      for (const key of ['location', 'cache-control', 'cdn-cache-control', 'surrogate-control', 'content-type', 'content-security-policy', 'referrer-policy', 'retry-after', 'x-robots-tag']) if (response.headers[key]) res.setHeader(key, response.headers[key]);
      res.writeHead(response.statusCode || 502);
      response.on('error', () => res.destroy()); response.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => {
      if (!res.headersSent) { res.writeHead(502); res.end('CapreQR is temporarily unavailable.'); }
      else res.destroy();
    });
    res.on('close', () => upstream.destroy());
    upstream.end();
  });
}
