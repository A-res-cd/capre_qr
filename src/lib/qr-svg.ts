import QRCode from 'qrcode';
import { Buffer } from 'node:buffer';
import { designSchema, InputError } from './validation';
export function renderSVG(url: string, input: { foreground: string; background: string; logo?: Uint8Array | null }, width = 768) {
  designSchema.parse({ foreground: input.foreground, background: input.background });
  if (!Number.isInteger(width) || width < 256 || width > 2048) throw new InputError('Export size must be 256–2048 pixels.');
  const qr = QRCode.create(url, { errorCorrectionLevel: 'H' });
  const n = qr.modules.size, box = n + 8;
  if (width / box < 4) throw new InputError(`Choose at least ${Math.ceil(box * 4 / 64) * 64}px for this link.`);
  let path = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(y, x)) path += `M${x + 4} ${y + 4}h1v1h-1z`;
  const logoSize = Math.floor(n * 0.18), origin = (box - logoSize) / 2;
  const overlay = input.logo ? `<rect x="${origin - 1}" y="${origin - 1}" width="${logoSize + 2}" height="${logoSize + 2}" fill="${input.background}"/><image x="${origin}" y="${origin}" width="${logoSize}" height="${logoSize}" href="data:image/png;base64,${Buffer.from(input.logo).toString('base64')}"/>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="0 0 ${box} ${box}"><rect width="${box}" height="${box}" fill="${input.background}"/><path d="${path}" fill="${input.foreground}" shape-rendering="crispEdges"/>${overlay}</svg>`;
  return svg;
}
