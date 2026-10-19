import { describe, it, expect } from 'vitest';
import { destinationSchema, codeSchema, reliableColors } from '../src/lib/validation';
import { configuredMember, effectiveMember, owners } from '../src/lib/staff-policy';
import { deviceCategory, excludedRequest } from '../src/lib/queue';
import { rangeFor, csvCell } from '../src/lib/analytics';
import { renderQR, sanitizeLogo } from '../src/lib/qr';
import sharp from 'sharp';
import jsQR from 'jsqr';
describe('safe inputs and privacy', () => {
  it('accepts only HTTP(S) destinations without credentials', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.org', 'https://name:secret@example.org', '//example.org', 'https://example.org/a\nb']) expect(destinationSchema.safeParse(url).success).toBe(false);
    expect(destinationSchema.parse(' https://example.org/a?q=1 ')).toBe('https://example.org/a?q=1');
    expect(destinationSchema.parse('HTTPS://EXAMPLE.ORG')).toBe('https://example.org/');
  });
  it('rejects unreadable and inverted color choices', () => {
    expect(reliableColors('#102d32', '#ffffff')).toBe(true);
    expect(reliableColors('#ffffff', '#102d32')).toBe(false);
    expect(codeSchema.safeParse({ name: 'QR', destination: 'https://example.org', foreground: '#cccccc', background: '#ffffff' }).success).toBe(false);
  });
  it('classifies coarse devices and excludes recognizable automated requests', () => {
    expect(deviceCategory('Mozilla Android Mobile')).toBe('mobile'); expect(deviceCategory('iPad')).toBe('tablet'); expect(deviceCategory('Windows NT')).toBe('desktop'); expect(deviceCategory('')).toBe('unknown');
    for (const ua of ['Googlebot', 'Slackbot-LinkExpanding', 'facebookexternalhit', 'HealthCheck']) expect(excludedRequest(new Headers({ 'user-agent': ua }))).toBe(true);
    expect(excludedRequest(new Headers({ 'sec-purpose': 'prefetch' }))).toBe(true);
    expect(excludedRequest(new Headers({ 'user-agent': 'Mozilla iPhone Mobile' }))).toBe(false);
  });
  it('keeps a protected recovery owner and lets database revocation override configured staff', () => {
    expect(configuredMember({},'a@example.org')).toBeNull();
    const config={STAFF_EMAILS:' A@example.org, teammate@example.org '};
    expect(owners(config)).toEqual(['a@example.org']);
    expect(configuredMember(config,'a@example.org')?.role).toBe('OWNER');
    const revoked={email:'teammate@example.org',role:'STAFF' as const,active:false,version:1,updatedAt:null,configured:false};
    expect(effectiveMember(config,revoked.email,revoked)?.active).toBe(false);
    expect(effectiveMember(config,'a@example.org',{...revoked,email:'a@example.org'})?.active).toBe(true);
    expect(owners({...config,OWNER_EMAILS:' Owner@example.org '})).toEqual(['owner@example.org']);
  });
  it('uses local reporting days across DST and partial-hour offsets', () => {
    const dst = rangeFor(new URLSearchParams({ start: '2026-03-08', end: '2026-03-08' }), 'America/New_York');
    expect(dst.to.getTime() - dst.from.getTime()).toBe(23 * 3600000);
    const nepal = rangeFor(new URLSearchParams({ start: '2026-01-01', end: '2026-01-01' }), 'Asia/Kathmandu');
    expect(nepal.from.toISOString()).toBe('2025-12-31T18:15:00.000Z');
    expect(() => rangeFor(new URLSearchParams({ start: '2026-02-30' }), 'UTC')).toThrow();
    expect(() => rangeFor(new URLSearchParams({ start: '2026-10-05', end: '2026-01-01' }), 'UTC')).toThrow();
  });
  it('neutralizes spreadsheet formulas and quotes in CSV', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"'); expect(csvCell('normal, name')).toBe('"normal, name"');
  });
});
describe('QR images', () => {
  it('renders PNG and SVG with quiet zones, chosen dimensions and escaped-safe colors', async () => {
    const options = { foreground: '#102d32', background: '#ffffff' };
    const png = await renderQR('https://qr.example.org/AbCdEfGhIjKl', options, 768, 'png');
    const meta = await sharp(png).metadata(); expect(meta.width).toBe(768); expect(meta.format).toBe('png');
    const raw = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(jsQR(new Uint8ClampedArray(raw.data), raw.info.width, raw.info.height)?.data).toBe('https://qr.example.org/AbCdEfGhIjKl');
    const svg = (await renderQR('https://qr.example.org/AbCdEfGhIjKl', options)).toString(); expect(svg).toContain('viewBox'); expect(svg).toContain('M4 ');
    await expect(renderQR('https://qr.example.org/a', options, 100)).rejects.toThrow('256');
  });
  it('rejects SVG, oversized, malformed, and decompression-heavy logo uploads', async () => {
    await expect(sanitizeLogo('data:image/svg+xml;base64,PHN2Zz4=')).rejects.toThrow();
    await expect(sanitizeLogo(`data:image/png;base64,${Buffer.alloc(512001).toString('base64')}`)).rejects.toThrow('500 KB');
    await expect(sanitizeLogo('data:image/png;base64,AAAA')).rejects.toThrow();
    const logo = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#0e766c' } }).png().toBuffer();
    const clean = await sanitizeLogo(`data:image/png;base64,${logo.toString('base64')}`); expect((await sharp(clean!).metadata()).format).toBe('png');
    const png = await renderQR('https://qr.example.org/AbCdEfGhIjKl', { foreground: '#102d32', background: '#ffffff', logo: clean }, 768, 'png');
    expect((await sharp(png).metadata()).width).toBe(768);
    const raw = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(jsQR(new Uint8ClampedArray(raw.data), raw.info.width, raw.info.height)?.data).toBe('https://qr.example.org/AbCdEfGhIjKl');
  });
});
