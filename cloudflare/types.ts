import type { D1Database } from '@cloudflare/workers-types';
export interface Env {
  DB: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
  AUTH_SECRET: string;
  AUTH_GOOGLE_ID: string;
  AUTH_GOOGLE_SECRET: string;
  AUTH_URL: string;
  QR_BASE_URL: string;
  STAFF_EMAILS: string;
  OWNER_EMAILS?: string;
  REPORTING_TIMEZONE?: string;
  ANALYTICS_RETENTION_DAYS?: string;
  ANALYTICS_ENQUEUE_TIMEOUT_MS?: string;
}
export interface Context { waitUntil(promise: Promise<unknown>): void }
export interface QRRow {
  id: string; shortCode: string; name: string; description: string; destination: string;
  status: 'ACTIVE' | 'PAUSED'; archived: number; foreground: string; background: string;
  logo: string | null; folderId: string | null; totalScans: number; lastScannedAt: string | null;
  createdAt: string; updatedAt: string; version: number; mutationId: string;
}
