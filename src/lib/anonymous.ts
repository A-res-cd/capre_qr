export function deviceCategory(ua: string) {
  if (/ipad|tablet|kindle|silk|android(?!.*mobile)/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android/i.test(ua)) return 'mobile';
  if (/windows|macintosh|linux|cros/i.test(ua)) return 'desktop';
  return 'unknown';
}
export function excludedRequest(headers: Headers) {
  return /bot|crawler|spider|preview|slack|discord|facebookexternalhit|whatsapp|telegram|headless|uptime|healthcheck|pingdom/i.test(headers.get('user-agent') || '') || /prefetch|preview/i.test(`${headers.get('purpose') || ''} ${headers.get('sec-purpose') || ''}`);
}
