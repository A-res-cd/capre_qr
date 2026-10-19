import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { SignJWT, jwtVerify, generateKeyPair, exportJWK } from 'jose';
import sharp from 'sharp';
import worker from '../cloudflare/worker';
import { sessionToken } from '../cloudflare/auth';
import { processPending, scheduledAnalytics } from '../cloudflare/queue';
import type { Env } from '../cloudflare/types';
let mf: Miniflare, env: Env, token: string;
const background:Promise<unknown>[]=[];
const ctx={waitUntil(p:Promise<unknown>){background.push(p);}};
const input={name:'D1 welcome guide',destination:'https://example.org/first',folder:'Welcome',tags:['print']};
async function flush(){await Promise.allSettled(background.splice(0));}
async function api(path:string,method='GET',body?:unknown,overrides:Record<string,string>={}){
  return worker.fetch(new Request(env.AUTH_URL+'/api/manage/'+path,{method,headers:{cookie:'capreqr-session='+token,...(method!=='GET'?{origin:env.AUTH_URL,'content-type':'application/json'}:{}),...overrides},body:body===undefined?undefined:JSON.stringify(body)}),env,ctx);
}
async function create(name:string){const r=await api('codes','POST',{...input,name});expect(r.status,await r.clone().text()).toBe(200);return r.json();}
async function scan(code:string,ua='Mozilla iPhone Mobile',method='GET',bindings=env){const r=await worker.fetch(new Request(env.QR_BASE_URL+'/'+code,{method,headers:{'user-agent':ua}}),bindings,ctx);await flush();return r;}
beforeAll(async()=>{
  mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-10-19',d1Databases:{DB:'isolated-capreqr-tests'}}));
  env={DB:await mf.getD1Database('DB') as unknown as Env['DB'],ASSETS:{fetch:async()=>new Response('<h1>CapreQR</h1>',{headers:{'Content-Type':'text/html'}})},AUTH_URL:'https://capreqr.example',QR_BASE_URL:'https://qr.example',AUTH_SECRET:'test-only-secret-with-more-than-32-random-characters',AUTH_GOOGLE_ID:'test-google-client',AUTH_GOOGLE_SECRET:'test-client-secret',STAFF_EMAILS:'staff@example.org',REPORTING_TIMEZONE:'Asia/Manila',ANALYTICS_RETENTION_DAYS:'90'};
  const statements:string[]=[], lines=(await readFile('cloudflare/migrations/0001_initial.sql','utf8')).replace(/^\s*--.*$/gm,'').split('\n');
  let sql='',trigger=false;
  for(const line of lines){if(!line.trim())continue;if(/^CREATE TRIGGER/.test(line))trigger=true;sql+=' '+line.trim();if(trigger?/\bEND;\s*$/.test(line):/;\s*$/.test(line)){statements.push(sql);sql='';trigger=false;}}
  await env.DB.batch(statements.map(sql=>env.DB.prepare(sql)));
  token=await sessionToken(env,'staff@example.org');
});
afterAll(async()=>{await flush();await mf?.dispose();});
describe('Workers/D1 implementation',()=>{
  it('creates organized permanent codes and changes printed-link destinations atomically',async()=>{
    const code=await create('Permanent D1');expect(code.shortCode).toMatch(/^[A-Za-z0-9_-]{12}$/);expect(code.tags).toEqual(['print']);expect(code.folder).toBe('Welcome');
    const first=await scan(code.shortCode);expect(first.status).toBe(302);expect(first.headers.get('location')).toBe(input.destination);expect(first.headers.get('set-cookie')).toBeNull();expect(first.headers.get('cache-control')).toContain('no-store');
    const changed=await api('codes/'+code.id,'PUT',{...input,name:code.name,destination:'https://example.org/updated',version:code.version});expect(changed.status).toBe(200);const next=await changed.json();expect(next.shortCode).toBe(code.shortCode);expect((await scan(code.shortCode)).headers.get('location')).toBe('https://example.org/updated');
    const history=await (await api('codes/'+code.id)).json();expect(history.history.some((h:{actor:string;changes:unknown})=>h.actor==='staff@example.org'&&JSON.stringify(h.changes).includes(input.destination))).toBe(true);
    const conflict=await api('codes/'+code.id,'PUT',{...input,version:code.version});expect(conflict.status).toBe(409);
  });
  it('keeps archive separate from pause, supports duplication, and filters/clamps pagination',async()=>{
    let code=await create('Lifecycle D1');
    const action=async(name:string)=>{const r=await api('codes/'+code.id+'/action','POST',{action:name,version:code.version});expect(r.status).toBe(200);code=await r.json();};
    await action('archive');expect((await scan(code.shortCode)).status).toBe(302);
    expect((await (await api('codes?q=Lifecycle')).json()).total).toBe(0);
    await action('pause');const paused=await scan(code.shortCode);expect(paused.status).toBe(503);expect(paused.headers.get('location')).toBeNull();expect(await paused.text()).toContain('temporarily unavailable');
    await action('unarchive');expect(code.status).toBe('PAUSED');await action('reactivate');expect((await scan(code.shortCode)).status).toBe(302);
    const duplicate=await (await api('codes/'+code.id+'/action','POST',{action:'duplicate'})).json();expect(duplicate.shortCode).not.toBe(code.shortCode);expect(duplicate.totalScans).toBe(0);expect(duplicate.folder).toBe(code.folder);
    const page=await (await api('codes?q=Lifecycle&folder=Welcome&tag=print&page=99999')).json();expect(page.total).toBe(2);expect(page.page).toBe(page.pages);
  });
  it('forbids identity reuse/deletion and rolls back a failed audit with its destination/tags',async()=>{
    const code=await create('Atomic rollback');
    await expect(env.DB.prepare('UPDATE QRCode SET shortCode=? WHERE id=?').bind('Different123',code.id).run()).rejects.toThrow();
    await expect(env.DB.prepare('DELETE FROM QRCode WHERE id=?').bind(code.id).run()).rejects.toThrow();
    await env.DB.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON AuditLog WHEN NEW.action='updated' BEGIN SELECT RAISE(ABORT,'simulated audit failure'); END;");
    try{expect((await api('codes/'+code.id,'PUT',{...input,destination:'https://example.org/must-rollback',tags:['must-rollback'],version:code.version})).status).toBe(503);}finally{await env.DB.exec('DROP TRIGGER fail_audit;');}
    const after=(await (await api('codes/'+code.id)).json()).code;expect(after.destination).toBe(code.destination);expect(after.version).toBe(code.version);expect(after.tags).toEqual(code.tags);
  });
  it('concurrent staff edits accept one version and reject the other',async()=>{
    const code=await create('Concurrent');
    const responses=await Promise.all(['one','two'].map(suffix=>api('codes/'+code.id,'PUT',{...input,name:suffix,version:code.version})));
    expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
    expect((await (await api('codes/'+code.id)).json()).history).toHaveLength(2);
  });
  it('idempotent D1 processing stays correct across concurrency, replay, and retention',async()=>{
    await processPending(env);const code=await create('D1 idempotency'),now=new Date().toISOString(),id=crypto.randomUUID();
    const queue=()=>env.DB.prepare('INSERT INTO PendingScan(id,qrId,occurredAt,device,outcome,queuedAt) VALUES (?,?,?,?,?,?)').bind(id,code.id,now,'mobile','redirect',now).run();
    await queue();await Promise.all([processPending(env),processPending(env)]);await queue();await processPending(env);
    expect((await env.DB.prepare('SELECT totalScans FROM QRCode WHERE id=?').bind(code.id).first<{totalScans:number}>())!.totalScans).toBe(1);
    await env.DB.prepare('DELETE FROM ScanEvent WHERE id=?').bind(id).run();await queue();await processPending(env);
    expect((await env.DB.prepare('SELECT totalScans FROM QRCode WHERE id=?').bind(code.id).first<{totalScans:number}>())!.totalScans).toBe(1);
    const old=crypto.randomUUID();await env.DB.prepare('INSERT INTO PendingScan VALUES (?,?,?,?,?,?)').bind(old,code.id,'2020-01-01T00:00:00.000Z','desktop','redirect',now).run();await processPending(env);
    const hour=new Date();hour.setUTCMinutes(0,0,0);await scheduledAnalytics(env,hour.getTime());
    expect(await env.DB.prepare('SELECT id FROM ScanEvent WHERE id=?').bind(old).first()).toBeNull();expect(await env.DB.prepare('SELECT id FROM ProcessedEvent WHERE id=?').bind(old).first()).not.toBeNull();
    expect((await env.DB.prepare('SELECT lastScannedAt FROM QRCode WHERE id=?').bind(code.id).first<{lastScannedAt:string}>())!.lastScannedAt).toBe(now);
  });
  it('bots, health, and HEAD are excluded; paused visits remain separate; queue failures never block',async()=>{
    const code=await create('Anonymous');await scan(code.shortCode,'Googlebot');await scan(code.shortCode,'iPhone Mobile','HEAD');
    expect((await env.DB.prepare('SELECT count(*) AS count FROM PendingScan WHERE qrId=?').bind(code.id).first<{count:number}>())!.count).toBe(0);
    await scan(code.shortCode);let paused=await (await api('codes/'+code.id+'/action','POST',{action:'pause',version:code.version})).json();await scan(paused.shortCode);await processPending(env);
    const report=await (await api('analytics?qrId='+code.id)).json();expect(report.total).toBe(1);expect(report.pausedVisits).toBe(1);expect(report.devices).toEqual([{device:'mobile',count:1}]);
    const event=await env.DB.prepare('SELECT * FROM ScanEvent WHERE qrId=? LIMIT 1').bind(code.id).first();expect(Object.keys(event!).sort()).toEqual(['device','id','occurredAt','outcome','qrId']);
    const active=await create('Queue outage');const failing={...env,DB:new Proxy(env.DB,{get(target,key){if(key==='prepare')return(sql:string)=>sql.includes('INSERT OR IGNORE INTO PendingScan')?{bind:()=>({run:()=>Promise.reject(new Error('queue unavailable'))})}:target.prepare(sql);return Reflect.get(target,key);}})};
    expect((await scan(active.shortCode,'iPhone Mobile','GET',failing)).status).toBe(302);
  });
  it('reports DST dates correctly and exports aggregate CSV',async()=>{
    const code=await create('DST analytics'),now=new Date().toISOString();
    for(const time of ['2026-03-08T06:59:00.000Z','2026-03-09T03:59:00.000Z','2026-03-09T04:00:00.000Z'])await env.DB.prepare('INSERT INTO PendingScan VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),code.id,time,'mobile','redirect',now).run();
    await processPending(env);
    expect((await api('settings','PUT',{name:'Test',timezone:'America/New_York',retentionDays:90,accent:'#2e3f92'})).status).toBe(200);
    const query='analytics?qrId='+code.id+'&start=2026-03-08&end=2026-03-08';
    const report=await (await api(query)).json();expect(report.total).toBe(2);expect(report.trend).toEqual([{date:'2026-03-08',count:2}]);
    const csv=await api(query+'&format=csv');expect(csv.headers.get('content-type')).toContain('text/csv');expect(await csv.text()).toContain('redirect requests');
    expect((await api('analytics?start=2026-02-30')).status).toBe(400);
  });
  it('enforces every management boundary, Origin, invalid destinations, and revoked sessions',async()=>{
    const code=await create('Access');
    for(const path of ['codes','codes/'+code.id,'codes/'+code.id+'/download?format=svg','analytics','settings','options'])expect((await api(path,'GET',undefined,{cookie:''})).status).toBe(401);
    for(const path of ['codes','preview','codes/'+code.id+'/action'])expect((await api(path,'POST',{}, {cookie:''})).status).toBe(401);
    expect((await api('settings','PUT',{}, {cookie:''})).status).toBe(401);
    expect((await api('codes','POST',input,{origin:'https://evil.example'})).status).toBe(403);
    expect((await api('codes','POST',{...input,destination:'javascript:alert(1)'})).status).toBe(400);
    const bad=new Request(env.AUTH_URL+'/api/manage/codes',{headers:{cookie:'capreqr-session='+token+'invalid'}});expect((await worker.fetch(bad,env,ctx)).status).toBe(401);
    const good=new Request(env.AUTH_URL+'/api/manage/codes',{headers:{cookie:'capreqr-session='+token}});expect((await worker.fetch(good,{...env,STAFF_EMAILS:'revoked@example.org'},ctx)).status).toBe(401);
    const page=await worker.fetch(new Request(env.AUTH_URL+'/dashboard'),env,ctx);expect(page.status).toBe(302);expect(page.headers.get('location')).toBe('/signin');
    const writes=await api('codes/'+code.id,'DELETE');expect(writes.status).toBe(405);
  });
  it('renders authenticated SVGs and validates tiny metadata-free PNG logos',async()=>{
    const png=await sharp({create:{width:32,height:32,channels:4,background:'#2e3f92'}}).png().toBuffer();
    const forged=Buffer.from(png);forged.writeUInt32BE(1,16);forged.writeUInt32BE(1,20);
    let crc=0xffffffff;for(const byte of forged.subarray(12,29)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}forged.writeUInt32BE((crc^0xffffffff)>>>0,29);
    expect((await api('preview','POST',{foreground:'#102d32',background:'#ffffff',logo:'data:image/png;base64,'+forged.toString('base64')})).status).toBe(400);
    const code=await (await api('codes','POST',{...input,name:'Logo',logo:'data:image/png;base64,'+png.toString('base64')})).json();expect(code.hasLogo).toBe(true);
    const svg=await api('codes/'+code.id+'/download?format=svg&width=768');expect(svg.status).toBe(200);expect(await svg.text()).toContain('<image');
    expect((await api('codes/'+code.id+'/download?format=png')).status).toBe(400);
    expect((await api('preview','POST',{foreground:'#102d32',background:'#ffffff',logo:'data:image/svg+xml;base64,PHN2Zz4='})).status).toBe(400);
    expect((await api('preview','POST',{foreground:'#eeeeee',background:'#ffffff'})).status).toBe(400);
  });
  it('uses Google PKCE/state/nonce and verifies Google ID tokens before creating staff sessions',async()=>{
    const begin=await worker.fetch(new Request(env.AUTH_URL+'/api/auth/signin/google'),env,ctx);expect(begin.status).toBe(302);
    const google=new URL(begin.headers.get('location')!);expect(google.origin).toBe('https://accounts.google.com');expect(google.searchParams.get('code_challenge_method')).toBe('S256');expect(google.searchParams.get('redirect_uri')).toBe(env.AUTH_URL+'/api/auth/callback/google');
    const stateCookie=begin.headers.get('set-cookie')!.split(';')[0],saved=stateCookie.slice(stateCookie.indexOf('=')+1);
    const {payload}=await jwtVerify(saved,new TextEncoder().encode(env.AUTH_SECRET),{issuer:'capreqr',audience:'oauth'});
    const rejected=await worker.fetch(new Request(env.AUTH_URL+'/api/auth/callback/google?code=test&state=wrong',{headers:{cookie:stateCookie}}),env,ctx);expect(rejected.headers.get('location')).toContain('error=AccessDenied');
    const pair=await generateKeyPair('RS256'),jwk=await exportJWK(pair.publicKey);jwk.kid='google-test';jwk.alg='RS256';jwk.use='sig';
    const googleToken=await new SignJWT({email:'staff@example.org',email_verified:true,nonce:payload.nonce}).setProtectedHeader({alg:'RS256',kid:'google-test'}).setIssuer('https://accounts.google.com').setSubject('google-test-staff').setAudience(env.AUTH_GOOGLE_ID).setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
    const originalFetch=globalThis.fetch;
    vi.stubGlobal('fetch',async(url:RequestInfo|URL,init?:RequestInit)=>{
      if(String(url)==='https://oauth2.googleapis.com/token'){expect(new URLSearchParams(String(init?.body)).get('code_verifier')).toBe(payload.verifier);return Response.json({id_token:googleToken});}
      if(String(url)==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});
      return originalFetch(url,init);
    });
    try{
      const callback=await worker.fetch(new Request(env.AUTH_URL+'/api/auth/callback/google?code=test&state='+payload.state,{headers:{cookie:stateCookie}}),env,ctx);
      expect(callback.headers.get('location')).toBe(env.AUTH_URL+'/dashboard');expect(callback.headers.getSetCookie().some(c=>c.startsWith('capreqr-session=')&&c.includes('HttpOnly')&&c.includes('Secure'))).toBe(true);
    }finally{vi.unstubAllGlobals();}
  });
});
