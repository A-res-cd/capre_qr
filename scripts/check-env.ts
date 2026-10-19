import 'dotenv/config';
import { publicBase } from '../src/lib/validation';
const required = ['DATABASE_URL', 'AUTH_URL', 'AUTH_SECRET', 'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET', 'STAFF_EMAILS', 'QR_BASE_URL'];
const missing = required.filter(key => !process.env[key]?.trim());
if (missing.length) { console.error(`Missing environment variables: ${missing.join(', ')}`); process.exit(1); }
if (process.env.AUTH_SECRET!.length < 32) throw new Error('AUTH_SECRET must contain at least 32 random characters.');
const origin = new URL(process.env.AUTH_URL!);
if (origin.protocol !== 'https:' && origin.hostname !== 'localhost') throw new Error('AUTH_URL must use HTTPS outside localhost.');
new URL(process.env.DATABASE_URL!);
publicBase();
new Intl.DateTimeFormat('en', { timeZone: process.env.REPORTING_TIMEZONE || 'Asia/Manila' });
const days = Number(process.env.ANALYTICS_RETENTION_DAYS || 90);
if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('ANALYTICS_RETENTION_DAYS must be 1–3650.');
console.log('Environment configuration valid. Verify credentials and domain routing before printing.');
