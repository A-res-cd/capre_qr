import { z } from 'zod';
export class InputError extends Error {}
export const destinationSchema = z.string().trim().max(2048)
  .regex(/^[^\u0000-\u0020\u007f]+$/, 'URL cannot contain unencoded spaces or control characters.')
  .url().refine(value => {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
}, 'Use an HTTP or HTTPS URL without embedded credentials.')
  .transform(value => new URL(value).href);
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color.');
function luminance(color: string) {
  const c = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
export function reliableColors(fg: string, bg: string) {
  return (luminance(bg) + 0.05) / (luminance(fg) + 0.05) >= 4.5;
}
export const designSchema = z.object({ foreground: colorSchema.default('#102d32'), background: colorSchema.default('#ffffff'), logo: z.string().max(750000).nullable().optional() })
  .refine(v => reliableColors(v.foreground, v.background), { message: 'Use a dark foreground and light background with at least 4.5:1 contrast.', path: ['foreground'] });
export const codeSchema = z.object({
  name: z.string().trim().min(1).max(120), description: z.string().trim().max(2000).default(''), destination: destinationSchema,
  folder: z.string().trim().max(80).default(''), tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  foreground: colorSchema.default('#102d32'), background: colorSchema.default('#ffffff'), logo: z.string().max(750000).nullable().optional(),
}).refine(v => reliableColors(v.foreground, v.background), { message: 'Use dark modules on a light background, minimum contrast 4.5:1.', path: ['foreground'] });
export const settingsSchema = z.object({
  name: z.string().trim().min(1).max(100), timezone: z.string().max(100).refine(tz => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Use a valid IANA timezone.'),
  retentionDays: z.number().int().min(1).max(3650), accent: colorSchema,
});
export function publicBase() {
  const base = new URL(process.env.QR_BASE_URL || 'http://localhost:3000');
  if (!['http:', 'https:'].includes(base.protocol) || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('QR_BASE_URL must be a plain HTTP(S) origin.');
  if (process.env.NODE_ENV === 'production' && base.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Production QR_BASE_URL must use HTTPS.');
  return base.origin;
}
export const shortLink = (code: string) => `${publicBase()}/${code}`;
