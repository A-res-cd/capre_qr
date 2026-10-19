import type { Env } from './types';
import { checkMemberChange, configuredMember, effectiveMember, memberInput, roster, type Member } from '../src/lib/staff-policy';
import { HttpError } from './common';
type Row={email:string;role:'OWNER'|'STAFF';active:number;version:number;updatedAt:string};
const member=(r:Row):Member=>({...r,active:!!r.active,configured:false});
export async function membership(env:Env,email:string) {
  email=email.toLowerCase();
  if(configuredMember(env,email)?.configured)return configuredMember(env,email);
  const row=await env.DB.prepare('SELECT * FROM StaffMember WHERE email=?').bind(email).first<Row>();
  return effectiveMember(env,email,row?member(row):null);
}
export async function requireOwner(env:Env,actor:string) {
  const current=await membership(env,actor);
  if(!current?.active||current.role!=='OWNER')throw new HttpError(403,'Only owners can manage staff access.');
}
export async function staffList(env:Env,actor:string) {
  await requireOwner(env,actor);
  const rows=await env.DB.prepare('SELECT * FROM StaffMember ORDER BY email').all<Row>();
  const history=await env.DB.prepare("SELECT id,actor,action,changes,createdAt FROM AuditLog WHERE action LIKE 'staff.%' ORDER BY createdAt DESC LIMIT 50").all<{id:string;actor:string;action:string;changes:string;createdAt:string}>();
  return {members:roster(env,rows.results.map(member)),history:history.results.map(h=>({...h,changes:JSON.parse(h.changes)}))};
}
export async function saveMember(env:Env,actor:string,body:unknown) {
  await requireOwner(env,actor);
  const value=memberInput.parse(body);checkMemberChange(env,actor,value.email);
  const before=await membership(env,value.email),now=new Date().toISOString();
  if((before?.version||0)!==value.version)throw new HttpError(409,'Staff access changed. Refresh and try again.');
  const after={...value,version:value.version+1,updatedAt:now,configured:false};
  const mutation=crypto.randomUUID();
  // In the same atomic batch, changes() guards the audit on the update result.
  const update=value.version===0
    ?env.DB.prepare('INSERT OR IGNORE INTO StaffMember(email,role,active,version,updatedAt) VALUES (?,?,?,1,?)').bind(value.email,value.role,Number(value.active),now)
    :env.DB.prepare('UPDATE StaffMember SET role=?,active=?,version=version+1,updatedAt=? WHERE email=? AND version=?').bind(value.role,Number(value.active),now,value.email,value.version);
  const result=await env.DB.batch([update,env.DB.prepare("INSERT INTO AuditLog(id,qrId,actor,action,changes,createdAt) SELECT ?,NULL,?,'staff.updated',?,? WHERE changes()>0").bind(mutation,actor,JSON.stringify({before,after}),now)]);
  if(!result[0].meta.changes)throw new HttpError(409,'Staff access changed. Refresh and try again.');
  return after;
}
