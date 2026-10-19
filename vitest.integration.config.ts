import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
const url = process.env.INTEGRATION_DATABASE_URL;
if (!url || new URL(url).pathname !== '/qr_integration_test') throw new Error('Set INTEGRATION_DATABASE_URL to a disposable PostgreSQL database named qr_integration_test.');
export default defineConfig({ resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }, test: { include: ['tests/integration.test.ts'], environment: 'node', fileParallelism: false, testTimeout: 15000, hookTimeout: 15000, env: { DATABASE_URL: url, QR_BASE_URL: 'https://qr.example.org', AUTH_URL: 'https://staff.example.org', STAFF_EMAILS: 'staff@example.org' } } });
