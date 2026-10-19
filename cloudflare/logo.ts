import { decode } from 'fast-png';
import { Buffer } from 'node:buffer';
import { inflateSync } from 'node:zlib';
import { InputError } from '../src/lib/validation';
// Dashboard normalizes JPEG/PNG uploads to <=256px PNG using the browser canvas.
// Independent server checks prevent oversized decompression and strip metadata.
export function sanitizeWorkerLogo(data: string | null | undefined) {
  if (data == null) return data;
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!match) throw new InputError('Upload the logo through the dashboard to safely convert PNG/JPEG to PNG.');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length > 512000 || bytes.length < 33 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw new InputError('Use a PNG logo under 500 KB.');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 256 || height > 256 || bytes[24] !== 8 || ![2,6].includes(bytes[25]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) throw new InputError('Logo must be a 256px-or-smaller non-interlaced RGB/RGBA PNG. Use the dashboard upload control.');
  try {
    const parts: Buffer[] = [bytes.subarray(0,8)], compressed: Buffer[] = []; let end = false;
    for (let offset = 8; offset < bytes.length;) {
      if (offset + 12 > bytes.length) throw new Error();
      const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
      if (size > bytes.length - offset - 12 || type === 'acTL') throw new Error();
      if (['IHDR','IDAT','IEND'].includes(type)) parts.push(bytes.subarray(offset, offset + size + 12));
      if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + size));
      offset += size + 12;
      if (type === 'IEND') { end = true; break; }
    }
    if (!end) throw new Error();
    // A forged small IHDR can hide a huge deflate stream. Bound decompression
    // before the PNG decoder allocates its output. One extra byte also lets us
    // reject streams that do not exactly match the declared scanline size.
    const expected = height * (1 + width * (bytes[25] === 6 ? 4 : 3));
    if (inflateSync(Buffer.concat(compressed), { maxOutputLength: expected + 1 }).length !== expected) throw new Error();
    const clean = Buffer.concat(parts);
    const image = decode(clean, { checkCrc: true });
    if (image.width !== width || image.height !== height) throw new Error();
    return `data:image/png;base64,${clean.toString('base64')}`;
  } catch { throw new InputError('Logo is not a valid still PNG. Upload it again through the dashboard.'); }
}
