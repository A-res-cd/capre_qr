import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from './db';
import { codeSchema, shortLink } from './validation';
import { sanitizeLogo } from './qr';
import { HttpError } from './errors';
export { HttpError } from './errors';
const relations = { folder: true, tags: { include: { tag: true } } } as const;
export async function findCode(id: string) {
  const code = await db.qRCode.findUnique({ where: { id }, include: relations });
  if (!code) throw new HttpError(404, 'QR code not found.');
  return code;
}
export function present(code: Awaited<ReturnType<typeof findCode>>) {
  const { logo, tags, folder, ...rest } = code;
  return { ...rest, hasLogo: !!logo, folder: folder?.name ?? '', tags: tags.map(t => t.tag.name), shortLink: shortLink(code.shortCode) };
}
export async function saveCode(raw: unknown, actor: string, id?: string, version?: number) {
  const input = codeSchema.parse(raw);
  const logo = await sanitizeLogo(input.logo);
  const tags = [...new Set(input.tags.map(s => s.toLowerCase()))];
  return db.$transaction(async tx => {
    const prior = id ? await tx.qRCode.findUnique({ where: { id } }) : null;
    if (id && !prior) throw new HttpError(404, 'QR code not found.');
    if (prior && prior.version !== version) throw new HttpError(409, 'Someone changed this QR. Reload before saving.');
    const folder = input.folder ? await tx.folder.upsert({ where: { name: input.folder }, update: {}, create: { name: input.folder } }) : null;
    const data = { name: input.name, description: input.description, destination: input.destination, foreground: input.foreground, background: input.background, folderId: folder?.id ?? null, ...(logo !== undefined ? { logo: logo ? new Uint8Array(logo) : null } : {}) };
    let qrId: string;
    if (prior) {
      const updated = await tx.qRCode.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
      if (!updated.count) throw new HttpError(409, 'QR changed. Reload before saving.');
      qrId = prior.id;
      await tx.qRCodeTag.deleteMany({ where: { qrId } });
    } else {
      qrId = (await tx.qRCode.create({ data: { ...data, shortCode: randomBytes(9).toString('base64url') } })).id;
    }
    for (const name of tags) {
      const tag = await tx.tag.upsert({ where: { name }, update: {}, create: { name } });
      await tx.qRCodeTag.create({ data: { qrId, tagId: tag.id } });
    }
    const changes = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, key === 'logo' ? { changed: true } : { from: prior ? (prior as unknown as Record<string, unknown>)[key] : null, to: value }]));
    await tx.auditLog.create({ data: { qrId, actor, action: prior ? 'updated' : 'created', changes: { ...changes, tags } as Prisma.InputJsonValue } });
    return present(await tx.qRCode.findUniqueOrThrow({ where: { id: qrId }, include: relations }));
  });
}
export async function lifecycle(id: string, action: string, actor: string, version?: number) {
  if (action === 'duplicate') {
    const code = await findCode(id);
    return saveCode({ ...present(code), name: `${code.name.slice(0, 110)} (copy)`, logo: code.logo ? `data:image/png;base64,${Buffer.from(code.logo).toString('base64')}` : null }, actor);
  }
  const data = action === 'pause' ? { status: 'PAUSED' as const } : action === 'reactivate' ? { status: 'ACTIVE' as const } : action === 'archive' ? { archived: true } : action === 'unarchive' ? { archived: false } : null;
  if (!data) throw new HttpError(400, 'Unknown action.');
  return db.$transaction(async tx => {
    const before = await tx.qRCode.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, 'QR code not found.');
    const updated = await tx.qRCode.updateMany({ where: { id, version: version ?? -1 }, data: { ...data, version: { increment: 1 } } });
    if (!updated.count) throw new HttpError(409, 'QR changed. Reload before changing status.');
    await tx.auditLog.create({ data: { qrId: id, actor, action, changes: { from: { status: before.status, archived: before.archived }, to: data } } });
    return present(await tx.qRCode.findUniqueOrThrow({ where: { id }, include: relations }));
  });
}
export async function listCodes(params: URLSearchParams) {
  const requestedPage = Math.max(1, Math.min(100000, Math.floor(Number(params.get('page')) || 1)));
  const q = (params.get('q') || '').slice(0, 200);
  const status = params.get('status');
  const where: Prisma.QRCodeWhereInput = {
    archived: params.get('archived') === 'true',
    ...(status === 'ACTIVE' || status === 'PAUSED' ? { status } : {}),
    ...(params.get('folder') ? { folder: { name: params.get('folder')! } } : {}),
    ...(params.get('tag') ? { tags: { some: { tag: { name: params.get('tag')! } } } } : {}),
    ...(q ? { OR: ['name', 'destination', 'shortCode', 'description'].map(field => ({ [field]: { contains: q, mode: 'insensitive' } })) } : {}),
  };
  const sort = ['name', 'createdAt', 'totalScans', 'lastScannedAt'].includes(params.get('sort') || '') ? params.get('sort')! : 'createdAt';
  const total = await db.qRCode.count({ where });
  const pages = Math.max(1, Math.ceil(total / 12));
  const page = Math.min(requestedPage, pages);
  const codes = await db.qRCode.findMany({ where, include: relations, orderBy: [{ [sort]: params.get('direction') === 'asc' ? 'asc' : 'desc' }, { id: 'asc' }], take: 12, skip: (page - 1) * 12 });
  return { codes: codes.map(present), total, page, pages };
}
