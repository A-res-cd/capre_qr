import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose';
import type { Env } from './types';
import { assertOrigin, HttpError, json, originFor } from './common';
const sessionName = 'capreqr-session';
const stateName = 'capreqr-oauth';
const issuer = 'capreqr';
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
function secret(env: Env) {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) throw new HttpError(503, 'Configure AUTH_SECRET with at least 32 random characters.');
  return new TextEncoder().encode(env.AUTH_SECRET);
}
export function allowed(env: Env, email: string) { return (env.STAFF_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase()); }
function cookieValue(request: Request, name: string) { return (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1); }
function cookie(env: Env, name: string, value: string, seconds: number, path = '/') {
  const secure = originFor(env.AUTH_URL).startsWith('https:');
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=${path}; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
}
function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  cookies.forEach(c => headers.append('Set-Cookie', c)); return new Response(null, { status: 302, headers });
}
const random = () => crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
function base64url(bytes: ArrayBuffer) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, ''); }
export async function sessionToken(env: Env, email: string) {
  return new SignJWT({ email: email.toLowerCase(), verifiedStaff: true }).setProtectedHeader({ alg: 'HS256' }).setIssuer(issuer).setAudience('staff').setIssuedAt().setExpirationTime('8h').sign(secret(env));
}
export async function actor(request: Request, env: Env) {
  const token = cookieValue(request, sessionName); if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(env), { algorithms: ['HS256'], issuer, audience: 'staff', maxTokenAge: '8h', requiredClaims: ['exp','iat'] });
    return payload.verifiedStaff === true && typeof payload.email === 'string' && allowed(env, payload.email) ? payload.email.toLowerCase() : null;
  } catch { return null; }
}
export async function requireStaff(request: Request, env: Env) {
  const email = await actor(request, env); if (!email) throw new HttpError(401, 'Authorized staff sign-in required.');
  if (!['GET','HEAD'].includes(request.method)) assertOrigin(request, env);
  const window = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();
  const result = await env.DB.prepare('INSERT INTO RateLimit(key,window,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(`${email}:${window}`, window).first<{count:number}>();
  if ((result?.count || 0) > 240) throw new HttpError(429, 'Too many management requests. Try again in one minute.');
  return email;
}
export async function authRoute(request: Request, env: Env) {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/api/auth/session' && request.method === 'GET') {
    const email = await actor(request, env); return email ? json({ email }) : json({ error: 'Staff sign-in required.' }, 401);
  }
  if (path === '/api/auth/signout' && request.method === 'POST') {
    assertOrigin(request, env);
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(env, sessionName, '', 0) });
  }
  if (path === '/api/auth/signin/google' && request.method === 'GET') {
    if (!env.AUTH_GOOGLE_ID || !env.AUTH_GOOGLE_SECRET || !(env.STAFF_EMAILS || '').trim()) throw new HttpError(503, 'Configure Google OAuth and the staff allowlist before signing in.');
    const state = random(), verifier = random(), nonce = random();
    const signed = await new SignJWT({ state, verifier, nonce }).setProtectedHeader({ alg: 'HS256' }).setIssuer(issuer).setAudience('oauth').setIssuedAt().setExpirationTime('10m').sign(secret(env));
    const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    google.search = new URLSearchParams({ client_id: env.AUTH_GOOGLE_ID, redirect_uri: `${originFor(env.AUTH_URL)}/api/auth/callback/google`, response_type: 'code', scope: 'openid email profile', state, nonce, code_challenge: base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))), code_challenge_method: 'S256', prompt: 'select_account' }).toString();
    return redirect(google.href, [cookie(env, stateName, signed, 600, '/api/auth')]);
  }
  if (path === '/api/auth/callback/google' && request.method === 'GET') {
    const clearState = cookie(env, stateName, '', 0, '/api/auth');
    try {
      const saved = cookieValue(request, stateName);
      if (!saved || !url.searchParams.get('code') || !url.searchParams.get('state')) throw new Error();
      const { payload } = await jwtVerify(saved, secret(env), { algorithms: ['HS256'], issuer, audience: 'oauth', maxTokenAge: '10m', requiredClaims: ['exp','iat'] });
      if (payload.state !== url.searchParams.get('state') || typeof payload.verifier !== 'string') throw new Error();
      const exchange = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code')!, client_id: env.AUTH_GOOGLE_ID, client_secret: env.AUTH_GOOGLE_SECRET, redirect_uri: `${originFor(env.AUTH_URL)}/api/auth/callback/google`, code_verifier: payload.verifier }), signal: AbortSignal.timeout(8000) });
      if (!exchange.ok) throw new Error();
      const tokens = await exchange.json() as { id_token?: string };
      if (!tokens.id_token) throw new Error();
      const { payload: google } = await jwtVerify(tokens.id_token, googleKeys, { algorithms: ['RS256'], issuer: ['https://accounts.google.com','accounts.google.com'], audience: env.AUTH_GOOGLE_ID, requiredClaims: ['exp','iat','sub'], clockTolerance: 30 });
      if (google.azp && google.azp !== env.AUTH_GOOGLE_ID) throw new Error();
      if (google.nonce !== payload.nonce || google.email_verified !== true || typeof google.email !== 'string' || !allowed(env, google.email)) throw new Error();
      return redirect(`${originFor(env.AUTH_URL)}/dashboard`, [clearState, cookie(env, sessionName, await sessionToken(env, google.email), 8 * 3600)]);
    } catch {
      // Never log authorization codes, token responses, emails, or callback query strings.
      return redirect(`${originFor(env.AUTH_URL)}/signin?error=AccessDenied`, [clearState]);
    }
  }
  return json({ error: 'Not found.' }, 404);
}
