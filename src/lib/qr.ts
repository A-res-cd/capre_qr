import { renderSVG } from './qr-svg';
import sharp from 'sharp';
import { InputError } from './validation';
export async function sanitizeLogo(data: string | null | undefined): Promise<Buffer | null | undefined> {
  if (data == null) return data;
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!match) throw new InputError('Logo must be a PNG or JPEG image.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 512000) throw new InputError('Logo must be under 500 KB.');
  try {
    const input = sharp(bytes, { limitInputPixels: 16000000, animated: false });
    const meta = await input.metadata();
    if (!['png', 'jpeg'].includes(meta.format ?? '') || (meta.pages ?? 1) > 1) throw new InputError('Use a still PNG or JPEG logo.');
    return await input.rotate().resize(256, 256, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch { throw new InputError('Logo could not be decoded. Use a still PNG/JPEG under 500 KB and 16 million pixels.'); }
}
export async function renderQR(url: string, input: { foreground: string; background: string; logo?: Uint8Array | null }, width = 768, format: 'png' | 'svg' = 'svg') {
  const svg = renderSVG(url, input, width);
  return format === 'svg' ? Buffer.from(svg) : sharp(Buffer.from(svg)).png().toBuffer();
}
