import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireStaff, readJson } from '@/lib/manage';
import { db } from '@/lib/db';
import { HttpError, findCode, listCodes, present, saveCode, lifecycle } from '@/lib/codes';
import { analytics, analyticsCsv } from '@/lib/analytics';
import { getSettings } from '@/lib/settings';
import { settingsSchema, shortLink, designSchema, InputError } from '@/lib/validation';
import { renderQR, sanitizeLogo } from '@/lib/qr';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow' };
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const actor = await requireStaff(request);
    const { path } = await context.params;
    const [resource, id, action] = path;
    const params = new URL(request.url).searchParams;
    if (path.length > 3) throw new HttpError(404, 'Not found.');
    let data: unknown;
    if (resource === 'codes' && !id && request.method === 'GET') data = await listCodes(params);
    else if (resource === 'codes' && !id && request.method === 'POST') data = await saveCode(await readJson(request), actor);
    else if (resource === 'codes' && id) {
      z.uuid().parse(id);
      if (request.method === 'GET' && !action) data = { code: present(await findCode(id)), history: await db.auditLog.findMany({ where: { qrId: id }, orderBy: { createdAt: 'desc' }, take: 100 }) };
      else if (request.method === 'PUT' && !action) {
        const body = await readJson(request); data = await saveCode(body, actor, id, z.number().int().positive().parse(body.version));
      } else if (request.method === 'POST' && action === 'action') {
        const body = z.object({ action: z.enum(['duplicate', 'pause', 'reactivate', 'archive', 'unarchive']), version: z.number().int().positive().optional() }).parse(await readJson(request));
        data = await lifecycle(id, body.action, actor, body.version);
      } else if (request.method === 'GET' && action === 'download') {
        const code = await findCode(id);
        const format = z.enum(['png', 'svg']).parse(params.get('format') || 'png');
        const width = z.coerce.number().int().min(256).max(2048).parse(params.get('width') || 768);
        const image = await renderQR(shortLink(code.shortCode), code, width, format);
        return new Response(new Uint8Array(image), { headers: { ...headers, 'Content-Type': format === 'png' ? 'image/png' : 'image/svg+xml', 'Content-Disposition': `${params.get('inline') === 'true' ? 'inline' : 'attachment'}; filename="qr-${code.shortCode}.${format}"`, 'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'none'; sandbox" } });
      } else throw new HttpError(405, 'Method not allowed.');
    } else if (resource === 'preview' && !id && request.method === 'POST') {
      const body = await readJson(request);
      const input = designSchema.parse(body);
      const existing = body.id ? await findCode(z.uuid().parse(body.id)) : null;
      const logo = input.logo === undefined ? existing?.logo : await sanitizeLogo(input.logo);
      const image = await renderQR(shortLink('PREVIEW_ONLY'), { ...input, logo }, 512, 'svg');
      return new Response(new Uint8Array(image), { headers: { ...headers, 'Content-Type': 'image/svg+xml', 'Content-Security-Policy': "default-src 'none'; img-src data:; sandbox" } });
    } else if (resource === 'analytics' && !id && request.method === 'GET') {
      const report = await analytics(params);
      if (params.get('format') === 'csv') return new Response(analyticsCsv(report), { headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="qr-analytics.csv"' } });
      data = report;
    } else if (resource === 'settings' && !id && request.method === 'GET') data = await getSettings();
    else if (resource === 'settings' && !id && request.method === 'PUT') {
      const values = settingsSchema.parse(await readJson(request));
      data = await db.$transaction(async tx => {
        const before = await tx.organizationSettings.findUnique({ where: { id: 1 } });
        const result = await tx.organizationSettings.upsert({ where: { id: 1 }, update: values, create: { id: 1, ...values } });
        await tx.auditLog.create({ data: { actor, action: 'settings updated', changes: { before, after: values } } }); return result;
      });
    } else if (resource === 'options' && !id && request.method === 'GET') {
      data = { folders: await db.folder.findMany({ orderBy: { name: 'asc' } }), tags: await db.tag.findMany({ orderBy: { name: 'asc' } }) };
    } else throw new HttpError(404, 'Not found.');
    return NextResponse.json(data, { headers });
  } catch (error) {
    if (error instanceof InputError) return NextResponse.json({ error: error.message }, { status: 400, headers });
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400, headers });
    if (error instanceof HttpError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    // Do not log query parameters, destination values, headers, or raw request bodies.
    console.error('management_request_failed');
    return NextResponse.json({ error: 'Unable to complete request. Check database and input; try again.' }, { status: 500, headers });
  }
}
export { handle as GET, handle as POST, handle as PUT };
