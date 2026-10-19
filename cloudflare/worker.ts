import { z } from 'zod';
import { Buffer } from 'node:buffer';
import type { Context, Env, QRRow } from './types';
import { actor, authRoute, requireStaff } from './auth';
import { membership, staffList, saveMember } from './staff';
import { codeId, findCode, lifecycle, listCodes, present, saveCode } from './codes';
import { analytics, analyticsCsv } from './analytics';
import { HttpError, json, link, privateHeaders, readJson, settings } from './common';
import { enqueue, scheduledAnalytics } from './queue';
import { InputError, designSchema, settingsSchema } from '../src/lib/validation';
import { renderSVG } from '../src/lib/qr-svg';
import { sanitizeWorkerLogo } from './logo';

async function management(request: Request, env: Env) {
  const staff = await requireStaff(request, env);
  const url = new URL(request.url), [resource,id,action,...extra] = url.pathname.slice('/api/manage/'.length).split('/');
  if (extra.length) throw new HttpError(404,'Not found.');
  let data: unknown;
  if (resource === 'me' && !id && request.method === 'GET') data={email:staff,role:(await membership(env,staff))!.role};
  else if (resource === 'staff' && !id && request.method === 'GET') data=await staffList(env,staff);
  else if (resource === 'staff' && !id && request.method === 'PUT') data=await saveMember(env,staff,await readJson(request));
  else if (resource === 'codes' && !id) {
    if (request.method === 'GET') data = await listCodes(env,url.searchParams);
    else if (request.method === 'POST') data = await saveCode(env,await readJson(request),staff);
    else throw new HttpError(405,'Method not allowed.');
  } else if (resource === 'codes' && id) {
    codeId(id);
    if (request.method === 'GET' && !action) {
      const history = await env.DB.prepare('SELECT * FROM AuditLog WHERE qrId=? ORDER BY createdAt DESC LIMIT 100').bind(id).all<{id:string;actor:string;action:string;createdAt:string;changes:string}>();
      data = { code:present(env,await findCode(env,id)),history:history.results.map(h=>({...h,changes:JSON.parse(h.changes)})) };
    } else if (request.method === 'PUT' && !action) {
      const body = await readJson(request); data = await saveCode(env,body,staff,id,z.number().int().positive().parse(body.version));
    } else if (request.method === 'POST' && action === 'action') {
      const body = z.object({action:z.enum(['duplicate','pause','reactivate','archive','unarchive']),version:z.number().int().positive().optional()}).parse(await readJson(request));
      data = await lifecycle(env,id,body.action,staff,body.version);
    } else if (request.method === 'GET' && action === 'download') {
      const format = z.enum(['svg','png']).parse(url.searchParams.get('format') || 'png');
      if (format === 'png') throw new HttpError(400,'PNG downloads are rendered in your dashboard browser. Use SVG for direct API exports.');
      const row = await findCode(env,id), width = z.coerce.number().int().min(256).max(2048).parse(url.searchParams.get('width') || 768);
      return new Response(renderSVG(link(env,row.shortCode),{foreground:row.foreground,background:row.background,logo:row.logo ? Buffer.from(row.logo.split(',')[1],'base64') : null},width),{headers:{...privateHeaders,'Content-Type':'image/svg+xml','Content-Disposition':`${url.searchParams.get('inline') === 'true' ? 'inline':'attachment'}; filename="qr-${row.shortCode}.svg"`,'Content-Security-Policy':"default-src 'none'; img-src data:; sandbox"}});
    } else throw new HttpError(405,'Method not allowed.');
  } else if (resource === 'preview' && !id && request.method === 'POST') {
    const body = await readJson(request), input = designSchema.parse(body), existing = body.id ? await findCode(env,codeId(body.id)) : null;
    const logo = input.logo === undefined ? existing?.logo : sanitizeWorkerLogo(input.logo);
    return new Response(renderSVG(link(env,'PREVIEW_ONLY'),{...input,logo:logo ? Buffer.from(logo.split(',')[1],'base64') : null},512),{headers:{...privateHeaders,'Content-Type':'image/svg+xml','Content-Security-Policy':"default-src 'none'; img-src data:; sandbox"}});
  } else if (resource === 'analytics' && !id && request.method === 'GET') {
    const report = await analytics(env,url.searchParams);
    if (url.searchParams.get('format') === 'csv') return new Response(analyticsCsv(report),{headers:{...privateHeaders,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="qr-analytics.csv"'}});
    data = report;
  } else if (resource === 'settings' && !id && request.method === 'GET') data = await settings(env);
  else if (resource === 'settings' && !id && request.method === 'PUT') {
    const value = settingsSchema.parse(await readJson(request)), before = await settings(env);
    await env.DB.batch([
      env.DB.prepare('UPDATE OrganizationSettings SET name=?,timezone=?,retentionDays=?,accent=? WHERE id=1').bind(value.name,value.timezone,value.retentionDays,value.accent),
      env.DB.prepare('INSERT INTO AuditLog(id,qrId,actor,action,changes,createdAt) VALUES (?,NULL,?,?,?,?)').bind(crypto.randomUUID(),staff,'settings updated',JSON.stringify({before,after:value}),new Date().toISOString()),
    ]); data = {...value,id:1};
  } else if (resource === 'options' && !id && request.method === 'GET') {
    const results = await env.DB.batch([env.DB.prepare('SELECT * FROM Folder ORDER BY name'),env.DB.prepare('SELECT * FROM Tag ORDER BY name')]);
    data = { folders:results[0].results,tags:results[1].results };
  } else throw new HttpError(404,'Not found.');
  return json(data);
}
function escape(value: string) { return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!); }
async function publicScan(request: Request, env: Env, ctx: Context, code: string) {
  const headers = {...privateHeaders,'Cache-Control':'private, no-store, no-cache, max-age=0, must-revalidate','CDN-Cache-Control':'no-store','Surrogate-Control':'no-store'};
  const row = await env.DB.prepare('SELECT id,destination,status FROM QRCode WHERE shortCode=?').bind(code).first<Pick<QRRow,'id'|'destination'|'status'>>();
  if (!row) return new Response('QR link not found.',{status:404,headers});
  if (request.method === 'GET') { try { await enqueue(env,ctx,row.id,request.headers,row.status === 'ACTIVE' ? 'redirect':'paused'); } catch { console.warn('analytics_submission_failed'); } }
  if (row.status === 'ACTIVE') return new Response(null,{status:302,headers:{...headers,Location:row.destination}});
  const org = await settings(env);
  return new Response(request.method === 'HEAD' ? null : `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CapreQR · Link unavailable</title><body style="font-family:Segoe UI,system-ui,sans-serif;background:#faf9f4;color:#333;padding:10vh 24px;text-align:center"><main><p style="color:${org.accent}">${escape(org.name)}</p><h1 style="font-family:Georgia,serif;color:#2e3f92">This link is temporarily unavailable.</h1><p>Please check back later or contact the organization that shared this QR code.</p></main></body></html>`,{status:503,headers:{...headers,'Content-Type':'text/html; charset=utf-8','Retry-After':'3600','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"}});
}
async function route(request: Request, env: Env, ctx: Context) {
  const url = new URL(request.url), path = url.pathname;
  if (path.startsWith('/api/auth/')) return authRoute(request,env);
  if (path.startsWith('/api/manage/')) return management(request,env);
  if (path === '/api/health' && request.method === 'GET') {
    await env.DB.prepare('SELECT 1').first(); return json({status:'ok'});
  }
  if (/^\/[A-Za-z0-9_-]{12}$/.test(path)) {
    if (!['GET','HEAD'].includes(request.method)) throw new HttpError(405,'Method not allowed.');
    return publicScan(request,env,ctx,path.slice(1));
  }
  if (!['GET','HEAD'].includes(request.method)) throw new HttpError(405,'Method not allowed.');
  if (path === '/' || path === '/index.html') return new Response(null,{status:302,headers:{Location:'/dashboard',...privateHeaders}});
  if (path === '/dashboard') {
    if (!await actor(request,env)) return new Response(null,{status:302,headers:{Location:'/signin',...privateHeaders}});
    const asset=await env.ASSETS.fetch(new Request(new URL('/',request.url),request));
    return new Response(asset.body,{status:asset.status,headers:{...Object.fromEntries(asset.headers),...privateHeaders}});
  }
  if (path === '/signin') {
    const asset=await env.ASSETS.fetch(new Request(new URL('/',request.url),request));
    return new Response(asset.body,{status:asset.status,headers:{...Object.fromEntries(asset.headers),...privateHeaders}});
  }
  if (path.startsWith('/assets/') || path.startsWith('/fonts/')) return env.ASSETS.fetch(request);
  throw new HttpError(404,'Not found.');
}
export default {
  async fetch(request: Request, env: Env, ctx: Context) {
    let response: Response;
    try { response = await route(request,env,ctx); }
    catch (error) {
      if (error instanceof z.ZodError) response = json({error:error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')},400);
      else if (error instanceof InputError) response = json({error:error.message},400);
      else if (error instanceof HttpError) response = json({error:error.message},error.status);
      else { console.error('capreqr_request_failed'); response = json({error:'Service temporarily unavailable. Check database configuration and free-plan usage.'},503); }
    }
    const headers = new Headers(response.headers);
    for (const [key,value] of Object.entries(privateHeaders)) if (!headers.has(key)) headers.set(key,value);
    if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  },
  async scheduled(controller: { scheduledTime:number }, env: Env, ctx: Context) {
    ctx.waitUntil(scheduledAnalytics(env,controller.scheduledTime).catch(()=>{console.error('analytics_scheduled_processing_failed');}));
  },
};
