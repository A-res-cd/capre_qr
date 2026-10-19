import { db } from './db';
import { BRAND_PRIMARY, organizationAccent } from './brand';
export async function getSettings() {
  const timezone = process.env.REPORTING_TIMEZONE || 'Asia/Manila';
  const retention = Number(process.env.ANALYTICS_RETENTION_DAYS || 90);
  await db.$executeRaw`INSERT INTO "OrganizationSettings" (id,name,timezone,"retentionDays",accent) VALUES (1,'Our organization',${timezone},${retention},${BRAND_PRIMARY}) ON CONFLICT (id) DO NOTHING`;
  const settings = await db.organizationSettings.findUniqueOrThrow({ where: { id: 1 } });
  return { ...settings, accent: organizationAccent(settings.accent) };
}
