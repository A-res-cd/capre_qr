import { resolveRedirect } from '@/lib/redirect';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Context = { params: Promise<{ shortCode: string }> };
export async function GET(request: Request, context: Context) { return resolveRedirect(request, (await context.params).shortCode); }
export async function HEAD(request: Request, context: Context) { return resolveRedirect(request, (await context.params).shortCode, true); }
