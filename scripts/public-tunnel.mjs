// Free, temporary public scanning. Management routes never enter this gateway.
import http from 'node:http';
import { createScanGateway } from './scan-gateway.mjs';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
const toolsDir = path.join(root, '.local-tools');
const statePath = path.join(toolsDir, 'public-tunnel.json');
const envPath = path.join(root, '.env');
const localURL = new URL(process.env.CAPREQR_LOCAL_URL || 'http://127.0.0.1:3000');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(localURL.hostname) || localURL.protocol !== 'http:' || localURL.pathname !== '/' || localURL.username || localURL.password) throw new Error('CAPREQR_LOCAL_URL must be a local HTTP origin.');
const readState = async () => { try { return JSON.parse(await readFile(statePath, 'utf8')); } catch { return null; } };
function validState(state) { return state && Number.isInteger(state.controlPort) && state.controlPort > 0 && state.controlPort < 65536 && /^[a-f0-9]{64}$/.test(state.token); }
async function control(state, action) {
  if (!validState(state)) throw new Error('No valid tunnel state.');
  return fetch(`http://127.0.0.1:${state.controlPort}/${action}`, { method: action === 'stop' ? 'POST' : 'GET', headers: { 'x-capreqr-control': state.token }, signal: AbortSignal.timeout(2000) });
}
async function getBase() {
  const text = await readFile(envPath, 'utf8');
  return parse(text).QR_BASE_URL || 'http://localhost:3000';
}
async function setBase(value) {
  const text = await readFile(envPath, 'utf8');
  // Change this public setting alone. Never print or rewrite staff credentials.
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/).filter(line => !/^\s*QR_BASE_URL\s*=/.test(line));
  while (lines.at(-1) === '') lines.pop();
  await writeFile(envPath, `${lines.join(newline)}${newline}QR_BASE_URL=${value}${newline}`);
}
async function restore(state) {
  if (state?.url && await getBase() === state.url && /^https?:\/\//.test(state.previousBase || '')) await setBase(state.previousBase);
}
await mkdir(toolsDir, { recursive: true });
const previousState = await readState();
if (process.argv.includes('--stop')) {
  try {
    const response = await control(previousState, 'stop');
    if (!response.ok) throw new Error();
    console.log('CapreQR tunnel stopped. Previously downloaded tunnel QRs stop working.');
  } catch {
    await restore(previousState);
    await rm(statePath, { force: true });
    console.log('No running CapreQR tunnel found. Restored the previous QR base when applicable.');
  }
  process.exit(0);
}
if (previousState) {
  try {
    const response = await control(previousState, 'status');
    if (response.ok) { console.log(`CapreQR tunnel already running: ${(await response.json()).url}`); process.exit(0); }
  } catch { /* A prior process may have ended without cleanup. */ }
  await restore(previousState);
  await rm(statePath, { force: true });
}
const health = await fetch(new URL('/api/health', localURL), { signal: AbortSignal.timeout(5000) }).catch(() => null);
if (!health?.ok) throw new Error('Start CapreQR and PostgreSQL first. Local /api/health must return 200.');
await access(envPath);

async function cloudflaredBinary() {
  if (process.env.CLOUDFLARED_BIN) return process.env.CLOUDFLARED_BIN;
  if (process.platform !== 'win32' || process.arch !== 'x64') return 'cloudflared';
  const exe = path.join(toolsDir, 'cloudflared.exe');
  const expected = '4d2490e74082c5d48dbfedaf92576fa5bd1702379ab88eb7faa0cfbe8dc891b6';
  try { if (createHash('sha256').update(await readFile(exe)).digest('hex') === expected) return exe; } catch { /* Download verified binary below. */ }
  console.log('Downloading official cloudflared 2026.10.1 (Windows x64), then verifying SHA-256.');
  const response = await fetch('https://github.com/cloudflare/cloudflared/releases/download/2026.10.1/cloudflared-windows-amd64.exe', { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`cloudflared download failed (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('cloudflared checksum mismatch. Download rejected.');
  await writeFile(`${exe}.download`, bytes); await rename(`${exe}.download`, exe);
  return exe;
}
const executable = await cloudflaredBinary();
const previousBase = await getBase();
const token = randomBytes(32).toString('hex');
let state, child, shuttingDown = false;
const proxy = createScanGateway(localURL);
const controlServer = http.createServer(async (req, res) => {
  const supplied = req.headers['x-capreqr-control'];
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) { res.writeHead(403); res.end(); return; }
  if (req.url === '/status' && req.method === 'GET') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ url: state?.url })); return; }
  if (req.url === '/stop' && req.method === 'POST') { res.end('stopped'); setImmediate(() => shutdown()); return; }
  res.writeHead(404); res.end();
});
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  child?.kill(); proxy.close(); controlServer.close();
  await restore(state);
  const diskState = await readState();
  if (diskState?.token === token) await rm(statePath, { force: true });
  process.exit(exitCode);
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
await listen(proxy); await listen(controlServer);
try {
  let url, connected = false;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tunnel connection timed out. Check Internet connectivity.')), 90000);
    const ready = () => { if (url && connected) { clearTimeout(timer); resolve(); } };
    child = spawn(executable, ['tunnel', '--url', `http://127.0.0.1:${proxy.address().port}`, '--protocol', 'http2', '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let pending = '';
    const inspect = bytes => {
      pending += bytes.toString();
      const lines = pending.split(/\r?\n/); pending = lines.pop() || '';
      for (const line of lines) {
        url ||= line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
        if (line.includes('Registered tunnel connection')) connected = true;
        ready();
      }
    };
    child.stdout.on('data', inspect); child.stderr.on('data', inspect);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Unable to launch cloudflared. Install it or set CLOUDFLARED_BIN.')); });
    child.once('exit', () => {
      clearTimeout(timer);
      if (!state) reject(new Error('cloudflared exited before connecting.'));
      else if (!shuttingDown) { console.error('CapreQR tunnel disconnected.'); shutdown(1); }
    });
  });
  state = { url, previousBase, controlPort: controlServer.address().port, token };
  await setBase(url);
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  console.log(`CapreQR public scanning: ${url}`);
  console.log('QR_BASE_URL updated in .env. Keep staff sign-in at http://localhost:3000.');
  console.log('Download QR images again. Keep this process, CapreQR, and PostgreSQL running.');
  console.log('Temporary testing URL: it changes after restart. Do not use it for permanent printed codes.');
  console.log('Stop with Ctrl+C or npm run tunnel:stop.');
} catch (error) {
  console.error(error.message);
  await shutdown(1);
}
