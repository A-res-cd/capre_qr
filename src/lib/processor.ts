import { Prisma } from '@prisma/client';
import { db } from './db';
import type { AnonymousEvent } from './queue';
export async function processEvent(tx: Prisma.TransactionClient, event: AnonymousEvent) {
  const inserted = await tx.$executeRaw`INSERT INTO "ProcessedEvent" (id) VALUES (${event.id}::uuid) ON CONFLICT DO NOTHING`;
  if (!inserted) return false;
  await tx.scanEvent.create({ data: event });
  const bucket = new Date(Math.floor(event.occurredAt.getTime() / 60000) * 60000);
  await tx.scanSummary.upsert({ where: { qrId_bucket_device_outcome: { qrId: event.qrId, bucket, device: event.device, outcome: event.outcome } }, create: { qrId: event.qrId, bucket, device: event.device, outcome: event.outcome, count: 1 }, update: { count: { increment: 1 } } });
  if (event.outcome === 'redirect') await tx.$executeRaw`UPDATE "QRCode" SET "totalScans"="totalScans"+1, "lastScannedAt"=GREATEST("lastScannedAt", ${event.occurredAt}) WHERE id=${event.qrId}::uuid`;
  return true;
}
export async function processBatch() {
  return db.$transaction(async tx => {
    const events = await tx.$queryRaw<AnonymousEvent[]>`SELECT id,"qrId","occurredAt",device,outcome FROM "PendingScan" ORDER BY "queuedAt" LIMIT 100 FOR UPDATE SKIP LOCKED`;
    for (const event of events) {
      await processEvent(tx, event);
      await tx.pendingScan.delete({ where: { id: event.id } });
    }
    return events.length;
  }, { timeout: 30000 });
}
export async function retainEvents() {
  const settings = await db.organizationSettings.findUnique({ where: { id: 1 } });
  const days = settings?.retentionDays ?? (Number(process.env.ANALYTICS_RETENTION_DAYS) || 90);
  await db.scanEvent.deleteMany({ where: { occurredAt: { lt: new Date(Date.now() - days * 86400000) } } });
  await db.rateLimit.deleteMany({ where: { window: { lt: new Date(Date.now() - 86400000) } } });
}
