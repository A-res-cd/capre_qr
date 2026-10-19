import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const session = vi.hoisted(() => ({ value: null as null | { user: { email: string }; verifiedStaff: boolean } }));
vi.mock('@/auth', () => ({ auth: async () => session.value }));
import { db } from '../src/lib/db';
import { saveCode, findCode, lifecycle, listCodes } from '../src/lib/codes';
import { resolveRedirect } from '../src/lib/redirect';
import { processBatch, processEvent, retainEvents } from '../src/lib/processor';
import { analytics } from '../src/lib/analytics';
import { GET, POST, PUT } from '../src/app/api/manage/[...path]/route';
const input = { name: 'Welcome guide', destination: 'https://example.org/first', folder: 'Welcome', tags: ['print'] };
const staff = 'staff@example.org';
const request = (ua = 'Mozilla iPhone Mobile') => new Request('https://qr.example.org/AbCdEfGhIjKl', { headers: { 'user-agent': ua } });
const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });
beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ScanEvent", "ScanSummary", "ProcessedEvent", "PendingScan", "AuditLog", "QRCodeTag", "QRCode", "Folder", "Tag", "OrganizationSettings", "RateLimit" CASCADE');
});
afterAll(async () => { await db.$disconnect(); });
describe('real PostgreSQL lifecycle and analytics', () => {
  it('creates permanent random links and updates destinations for already printed codes', async () => {
    const code = await saveCode(input, staff);
    expect(code.shortCode).toMatch(/^[A-Za-z0-9_-]{12}$/); expect(code.shortLink).toBe(`https://qr.example.org/${code.shortCode}`);
    const before = await resolveRedirect(request(), code.shortCode);
    expect(before.status).toBe(302); expect(before.headers.get('location')).toBe(input.destination); expect(before.headers.get('cache-control')).toContain('no-store'); expect(before.headers.get('set-cookie')).toBeNull();
    const changed = await saveCode({ ...input, destination: 'https://example.org/second' }, staff, code.id, code.version);
    expect(changed.shortCode).toBe(code.shortCode);
    const after = await resolveRedirect(request(), code.shortCode); expect(after.headers.get('location')).toBe('https://example.org/second');
    const audit = await db.auditLog.findMany({ where: { qrId: code.id, action: 'updated' } }); expect(audit[0].actor).toBe(staff); expect(JSON.stringify(audit[0].changes)).toContain('https://example.org/first');
    await expect(saveCode(input, staff, code.id, code.version)).rejects.toThrow('Reload');
  });
  it('pauses, archives, unarchives and reactivates without changing links', async () => {
    let code = await saveCode({ ...input, name: 'Lifecycle' }, staff);
    code = await lifecycle(code.id, 'archive', staff, code.version);
    expect((await resolveRedirect(request(), code.shortCode)).status).toBe(302);
    code = await lifecycle(code.id, 'pause', staff, code.version);
    const paused = await resolveRedirect(request(), code.shortCode); expect(paused.status).toBe(503); expect(paused.headers.get('location')).toBeNull(); expect(await paused.text()).toContain('temporarily unavailable');
    expect((await listCodes(new URLSearchParams())).codes.find(q => q.id === code.id)).toBeUndefined();
    expect((await listCodes(new URLSearchParams({ archived: 'true' }))).codes.some(q => q.id === code.id)).toBe(true);
    code = await lifecycle(code.id, 'unarchive', staff, code.version); expect(code.status).toBe('PAUSED');
    code = await lifecycle(code.id, 'reactivate', staff, code.version); expect((await resolveRedirect(request(), code.shortCode)).status).toBe(302);
    const duplicate = await lifecycle(code.id, 'duplicate', staff); expect(duplicate.shortCode).not.toBe(code.shortCode); expect(duplicate.totalScans).toBe(0); expect(duplicate.tags).toEqual(code.tags); expect(duplicate.destination).toBe(code.destination);
    const filtered = await listCodes(new URLSearchParams({ q: 'Lifecycle', tag: 'print', folder: 'Welcome', page: '99999' }));
    expect(filtered.codes).toHaveLength(2); expect(filtered.page).toBe(filtered.pages);
  });
  it('database forbids deleting a published code or altering its short code', async () => {
    const code = await saveCode({ ...input, name: 'Immutable' }, staff);
    await expect(db.qRCode.update({ where: { id: code.id }, data: { shortCode: 'OtherCode123' } })).rejects.toThrow();
    await expect(db.qRCode.delete({ where: { id: code.id } })).rejects.toThrow();
    expect((await findCode(code.id)).shortCode).toBe(code.shortCode);
  });
  it('redirects independently of staff auth and excludes bots, previews, and HEAD from analytics', async () => {
    session.value = null;
    const code = await saveCode({ ...input, name: 'Public' }, staff);
    const before = await db.pendingScan.count({ where: { qrId: code.id } });
    expect((await resolveRedirect(request('Googlebot'), code.shortCode)).status).toBe(302);
    expect((await resolveRedirect(request(), code.shortCode, true)).status).toBe(302);
    expect((await resolveRedirect(new Request('https://qr.example.org/a', { headers: { purpose: 'prefetch' } }), code.shortCode)).status).toBe(302);
    expect(await db.pendingScan.count({ where: { qrId: code.id } })).toBe(before);
    expect((await resolveRedirect(request(), 'Unknown_1234')).status).toBe(404);
  });
  it('queue retry and concurrent workers never double count; retention preserves receipts and totals', async () => {
    await processBatch();
    const code = await saveCode({ ...input, name: 'Idempotency' }, staff);
    const event = { id: randomUUID(), qrId: code.id, occurredAt: new Date(), device: 'mobile', outcome: 'redirect' as const };
    await db.pendingScan.create({ data: event }); await Promise.all([processBatch(), processBatch()]);
    expect((await findCode(code.id)).totalScans).toBe(1);
    await db.pendingScan.create({ data: event }); await processBatch();
    expect((await findCode(code.id)).totalScans).toBe(1);
    await db.scanEvent.delete({ where: { id: event.id } });
    await db.$transaction(tx => processEvent(tx, event)); expect((await findCode(code.id)).totalScans).toBe(1);
    const oldEvent = { ...event, id: randomUUID(), occurredAt: new Date('2020-01-01T00:00:00Z') };
    await db.$transaction(tx => processEvent(tx, oldEvent));
    expect((await findCode(code.id)).lastScannedAt?.getTime()).toBe(event.occurredAt.getTime());
    await retainEvents(); expect(await db.scanEvent.findUnique({ where: { id: oldEvent.id } })).toBeNull();
    expect(await db.processedEvent.findUnique({ where: { id: oldEvent.id } })).not.toBeNull(); expect((await findCode(code.id)).totalScans).toBe(2);
    const paused = { ...event, id: randomUUID(), outcome: 'paused' as const }; await db.$transaction(tx => processEvent(tx, paused));
    const report = await analytics(new URLSearchParams({ qrId: code.id })); expect(report.total).toBe(1); expect(report.pausedVisits).toBe(1); expect(report.devices).toEqual([{ device: 'mobile', count: 1 }]);
  });
  it('management APIs protect all reads, writes, exports, previews, and settings', async () => {
    session.value = null;
    for (const path of [['codes'], ['codes', randomUUID()], ['codes', randomUUID(), 'download'], ['analytics'], ['settings'], ['options']]) expect((await GET(new Request('https://staff.example.org/api/manage/' + path.join('/')), ctx(path))).status).toBe(401);
    for (const [method, path] of [[POST, ['codes']], [POST, ['preview']], [POST, ['codes', randomUUID(), 'action']], [PUT, ['settings']]] as const) expect((await method(new Request('https://staff.example.org/api/manage/x', { method: method === PUT ? 'PUT' : 'POST', headers: { origin: 'https://staff.example.org', 'content-type': 'application/json' }, body: '{}' }), ctx([...path]))).status).toBe(401);
    session.value = { user: { email: staff }, verifiedStaff: true };
    expect((await GET(new Request('https://staff.example.org/api/manage/codes'), ctx(['codes']))).status).toBe(200);
    const foreign = await POST(new Request('https://staff.example.org/api/manage/codes', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify(input) }), ctx(['codes'])); expect(foreign.status).toBe(403);
    const unsafe = await POST(new Request('https://staff.example.org/api/manage/codes', { method: 'POST', headers: { origin: 'https://staff.example.org', 'content-type': 'application/json' }, body: JSON.stringify({ ...input, destination: 'javascript:alert(1)' }) }), ctx(['codes'])); expect(unsafe.status).toBe(400);
  });
});
