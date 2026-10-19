import { rangeFor, csvCell } from './reporting';
export { rangeFor, csvCell } from './reporting';
import { Prisma } from '@prisma/client';
import { db } from './db';
import { getSettings } from './settings';
import { HttpError } from './codes';
export async function analytics(params: URLSearchParams) {
  const settings = await getSettings();
  const range = rangeFor(params, settings.timezone);
  const qrId = params.get('qrId');
  if (qrId && !/^[0-9a-f-]{36}$/i.test(qrId)) throw new HttpError(400, 'Invalid QR ID.');
  const filter = Prisma.sql`"bucket">=${range.from} AND "bucket"<${range.to} ${qrId ? Prisma.sql`AND "qrId"=${qrId}::uuid` : Prisma.empty}`;
  const [trend, devices, top, folders, outcomes, counts, recent, queue] = await Promise.all([
    db.$queryRaw<{ date: string; count: number }[]>(Prisma.sql`SELECT to_char(date_trunc(${range.grain}, timezone(${settings.timezone}, "bucket")), 'YYYY-MM-DD') AS date, SUM(count)::int AS count FROM "ScanSummary" WHERE ${filter} AND outcome='redirect' GROUP BY 1 ORDER BY 1`),
    db.$queryRaw<{ device: string; count: number }[]>(Prisma.sql`SELECT device, SUM(count)::int AS count FROM "ScanSummary" WHERE ${filter} AND outcome='redirect' GROUP BY device ORDER BY count DESC`),
    db.$queryRaw<{ id: string; name: string; count: number }[]>(Prisma.sql`SELECT q.id,q.name,SUM(s.count)::int AS count FROM (SELECT * FROM "ScanSummary" WHERE ${filter} AND outcome='redirect') s JOIN "QRCode" q ON q.id=s."qrId" GROUP BY q.id,q.name ORDER BY count DESC LIMIT 10`),
    db.$queryRaw<{ name: string; count: number }[]>(Prisma.sql`SELECT COALESCE(f.name,'Unfiled') AS name,SUM(s.count)::int AS count FROM (SELECT * FROM "ScanSummary" WHERE ${filter} AND outcome='redirect') s JOIN "QRCode" q ON q.id=s."qrId" LEFT JOIN "Folder" f ON f.id=q."folderId" GROUP BY f.name ORDER BY count DESC`),
    db.$queryRaw<{ outcome: string; count: number }[]>(Prisma.sql`SELECT outcome,SUM(count)::int AS count FROM "ScanSummary" WHERE ${filter} GROUP BY outcome`),
    Promise.all([db.qRCode.count(), db.qRCode.count({ where: { status: 'ACTIVE', archived: false } }), db.qRCode.count({ where: { status: 'PAUSED', archived: false } }), db.qRCode.count({ where: { archived: true } })]),
    db.qRCode.findMany({ where: { archived: false }, select: { id: true, name: true, status: true, createdAt: true, totalScans: true }, orderBy: { createdAt: 'desc' }, take: 5 }),
    db.pendingScan.count(),
  ]);
  // Fill missing periods with real zeroes; never invent sample scans.
  const filled: { date: string; count: number }[] = [];
  const values = new Map(trend.map(p => [p.date, p.count]));
  const cursor = new Date(`${range.start}T00:00:00Z`), end = new Date(`${range.end}T00:00:00Z`);
  if (range.grain === 'month') cursor.setUTCDate(1);
  if (range.grain === 'week') cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10); filled.push({ date, count: values.get(date) || 0 });
    if (range.grain === 'month') cursor.setUTCMonth(cursor.getUTCMonth() + 1); else cursor.setUTCDate(cursor.getUTCDate() + (range.grain === 'week' ? 7 : 1));
  }
  return { range: { start: range.start, end: range.end, grain: range.grain, timezone: settings.timezone }, trend: filled, devices, top, folders, total: outcomes.find(o => o.outcome === 'redirect')?.count || 0, pausedVisits: outcomes.find(o => o.outcome === 'paused')?.count || 0, counts: { total: counts[0], active: counts[1], paused: counts[2], archived: counts[3] }, recent, pendingEvents: queue };
}
export function analyticsCsv(data: Awaited<ReturnType<typeof analytics>>) {
  const rows: (string | number)[][] = [['section', 'label', 'scan_requests', 'timezone', 'start', 'end']];
  const add = (section: string, label: string, count: number) => rows.push([section, label, count, data.range.timezone, data.range.start, data.range.end]);
  add('total', 'redirect requests', data.total); add('paused', 'paused page visits', data.pausedVisits);
  data.trend.forEach(p => add('trend', p.date, p.count)); data.devices.forEach(p => add('device', p.device, p.count)); data.top.forEach(p => add('top QR', p.name, p.count)); data.folders.forEach(p => add('folder', p.name, p.count));
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
