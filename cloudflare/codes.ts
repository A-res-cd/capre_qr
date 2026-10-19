import { z } from 'zod';
import type { Env, QRRow } from './types';
import { HttpError, link } from './common';
import { codeSchema } from '../src/lib/validation';
import { sanitizeWorkerLogo } from './logo';
type Joined = QRRow & { folder: string | null; tags: string };
const select = `SELECT q.*,(SELECT name FROM Folder WHERE id=q.folderId) AS folder,
  COALESCE((SELECT json_group_array(t.name) FROM QRCodeTag qt JOIN Tag t ON t.id=qt.tagId WHERE qt.qrId=q.id),'[]') AS tags FROM QRCode q`;
export async function findCode(env: Env, id: string) {
  const row = await env.DB.prepare(`${select} WHERE q.id=?`).bind(id).first<Joined>();
  if (!row) throw new HttpError(404, 'QR code not found.'); return row;
}
export function present(env: Env, row: Joined) {
  const { logo, mutationId: _mutation, folderId: _folderId, ...rest } = row;
  return { ...rest, archived: !!row.archived, hasLogo: !!logo, folder: row.folder || '', tags: JSON.parse(row.tags) as string[], shortLink: link(env, row.shortCode) };
}
function shortCode() { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(9)))).replaceAll('+','-').replaceAll('/','_'); }
export async function saveCode(env: Env, raw: unknown, actor: string, id?: string, version?: number) {
  const input = codeSchema.parse(raw);
  const logo = sanitizeWorkerLogo(input.logo);
  const prior = id ? await findCode(env, id) : null;
  if (prior && prior.version !== version) throw new HttpError(409, 'Someone changed this QR. Reload before saving.');
  const qrId = id || crypto.randomUUID(), mutation = crypto.randomUUID(), now = new Date().toISOString();
  const tags = [...new Set(input.tags.map(t => t.toLowerCase()))];
  const statements = [];
  if (input.folder) {
    statements.push(prior
      ? env.DB.prepare('INSERT INTO Folder(id,name) SELECT ?,? WHERE EXISTS(SELECT 1 FROM QRCode WHERE id=? AND version=?) ON CONFLICT(name) DO NOTHING').bind(crypto.randomUUID(), input.folder, qrId, version!)
      : env.DB.prepare('INSERT OR IGNORE INTO Folder(id,name) VALUES (?,?)').bind(crypto.randomUUID(), input.folder));
  }
  const updateIndex = statements.length;
  if (prior) {
    statements.push(env.DB.prepare(`UPDATE QRCode SET name=?,description=?,destination=?,foreground=?,background=?,logo=?,
      folderId=(SELECT id FROM Folder WHERE name=?),updatedAt=?,version=version+1,mutationId=? WHERE id=? AND version=?`)
      .bind(input.name,input.description,input.destination,input.foreground,input.background,logo === undefined ? prior.logo : logo,input.folder,now,mutation,qrId,version!));
  } else {
    statements.push(env.DB.prepare(`INSERT INTO QRCode(id,shortCode,name,description,destination,foreground,background,logo,folderId,createdAt,updatedAt,mutationId)
      VALUES (?,?,?,?,?,?,?,?,(SELECT id FROM Folder WHERE name=?),?,?,?)`)
      .bind(qrId,shortCode(),input.name,input.description,input.destination,input.foreground,input.background,logo || null,input.folder,now,now,mutation));
  }
  statements.push(env.DB.prepare('DELETE FROM QRCodeTag WHERE qrId=? AND EXISTS(SELECT 1 FROM QRCode WHERE id=? AND mutationId=?)').bind(qrId,qrId,mutation));
  for (const tag of tags) {
    statements.push(env.DB.prepare('INSERT INTO Tag(id,name) SELECT ?,? WHERE EXISTS(SELECT 1 FROM QRCode WHERE id=? AND mutationId=?) ON CONFLICT(name) DO NOTHING').bind(crypto.randomUUID(),tag,qrId,mutation));
    statements.push(env.DB.prepare('INSERT INTO QRCodeTag(qrId,tagId) SELECT ?,id FROM Tag WHERE name=? AND EXISTS(SELECT 1 FROM QRCode WHERE id=? AND mutationId=?)').bind(qrId,tag,qrId,mutation));
  }
  const before = prior ? { name:prior.name,description:prior.description,destination:prior.destination,foreground:prior.foreground,background:prior.background,folder:prior.folder,tags:JSON.parse(prior.tags),hasLogo:!!prior.logo } : null;
  const after = { name:input.name,description:input.description,destination:input.destination,foreground:input.foreground,background:input.background,folder:input.folder,tags,hasLogo:!!(logo === undefined ? prior?.logo : logo) };
  statements.push(env.DB.prepare('INSERT INTO AuditLog(id,qrId,actor,action,changes,createdAt) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM QRCode WHERE id=? AND mutationId=?)')
    .bind(crypto.randomUUID(),qrId,actor,prior ? 'updated' : 'created',JSON.stringify({before,after}),now,qrId,mutation));
  const result = await env.DB.batch(statements);
  if (!result[updateIndex].meta.changes) throw new HttpError(409, 'QR changed. Reload before saving.');
  return present(env, await findCode(env, qrId));
}
export async function lifecycle(env: Env, id: string, action: string, actor: string, version?: number) {
  const prior = await findCode(env, id);
  if (action === 'duplicate') return saveCode(env, { ...present(env, prior), name: `${prior.name.slice(0,110)} (copy)`, logo: prior.logo }, actor);
  const data = action === 'pause' ? { column:'status', value:'PAUSED' } : action === 'reactivate' ? { column:'status', value:'ACTIVE' } : action === 'archive' ? { column:'archived', value:1 } : action === 'unarchive' ? { column:'archived', value:0 } : null;
  if (!data) throw new HttpError(400, 'Unknown action.');
  const mutation = crypto.randomUUID(), now = new Date().toISOString();
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE QRCode SET ${data.column}=?,version=version+1,updatedAt=?,mutationId=? WHERE id=? AND version=?`).bind(data.value,now,mutation,id,version || -1),
    env.DB.prepare('INSERT INTO AuditLog(id,qrId,actor,action,changes,createdAt) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM QRCode WHERE id=? AND mutationId=?)')
      .bind(crypto.randomUUID(),id,actor,action,JSON.stringify({from:{status:prior.status,archived:!!prior.archived},to:{[data.column]:data.value}}),now,id,mutation),
  ]);
  if (!result[0].meta.changes) throw new HttpError(409, 'QR changed. Reload before changing status.');
  return present(env, await findCode(env,id));
}
export async function listCodes(env: Env, params: URLSearchParams) {
  const clauses = ['q.archived=?'], values: (string|number)[] = [params.get('archived') === 'true' ? 1 : 0];
  const q = (params.get('q') || '').slice(0,200), status = params.get('status');
  if (q) { clauses.push('(q.name LIKE ? OR q.description LIKE ? OR q.destination LIKE ? OR q.shortCode LIKE ?)'); values.push(...Array(4).fill(`%${q}%`)); }
  if (status === 'ACTIVE' || status === 'PAUSED') { clauses.push('q.status=?'); values.push(status); }
  if (params.get('folder')) { clauses.push('q.folderId IN (SELECT id FROM Folder WHERE name=?)'); values.push(params.get('folder')!.slice(0,80)); }
  if (params.get('tag')) { clauses.push('EXISTS(SELECT 1 FROM QRCodeTag qt JOIN Tag t ON qt.tagId=t.id WHERE qt.qrId=q.id AND t.name=?)'); values.push(params.get('tag')!.slice(0,40)); }
  const where = clauses.join(' AND ');
  const total = (await env.DB.prepare(`SELECT count(*) AS total FROM QRCode q WHERE ${where}`).bind(...values).first<{total:number}>())!.total;
  const pages = Math.max(1,Math.ceil(total/12)), page = Math.min(pages,Math.max(1,Math.min(100000,Math.floor(Number(params.get('page')) || 1))));
  const sort = ['name','createdAt','totalScans','lastScannedAt'].includes(params.get('sort') || '') ? params.get('sort')! : 'createdAt';
  const direction = params.get('direction') === 'asc' ? 'ASC' : 'DESC';
  const rows = await env.DB.prepare(`${select} WHERE ${where} ORDER BY q.${sort} ${direction},q.id ASC LIMIT 12 OFFSET ?`).bind(...values,(page-1)*12).all<Joined>();
  return { codes: rows.results.map(r => present(env,r)), total, page, pages };
}
export const codeId = (id: string) => z.uuid().parse(id);
