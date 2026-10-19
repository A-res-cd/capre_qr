import { z } from 'zod';
import { HttpError } from './errors';
export type Role = 'OWNER' | 'STAFF';
export type AccessConfig = { STAFF_EMAILS?: string; OWNER_EMAILS?: string };
export type Member = { email:string; role:Role; active:boolean; version:number; updatedAt:string|null; configured:boolean };
export const emails = (value?:string) => [...new Set((value || '').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean))];
export const owners = (config:AccessConfig) => emails(config.OWNER_EMAILS).length ? emails(config.OWNER_EMAILS) : emails(config.STAFF_EMAILS).slice(0,1);
export function configuredMember(config:AccessConfig,email:string):Member|null {
  if(owners(config).includes(email))return {email,role:'OWNER',active:true,version:0,updatedAt:null,configured:true};
  return emails(config.STAFF_EMAILS).includes(email)?{email,role:'STAFF',active:true,version:0,updatedAt:null,configured:false}:null;
}
export function effectiveMember(config:AccessConfig,email:string,stored:Member|null) {
  const configured=configuredMember(config,email);
  return configured?.configured?configured:stored || configured;
}
export function roster(config:AccessConfig,rows:Member[]) {
  const map=new Map(rows.map(r=>[r.email,r]));
  for(const email of [...emails(config.STAFF_EMAILS),...owners(config)])map.set(email,effectiveMember(config,email,map.get(email)||null)!);
  return [...map.values()].sort((a,b)=>Number(b.active)-Number(a.active)||a.role.localeCompare(b.role)||a.email.localeCompare(b.email));
}
export const memberInput=z.object({email:z.string().trim().toLowerCase().email().max(254),role:z.enum(['OWNER','STAFF']),active:z.boolean(),version:z.number().int().min(0)}).strict();
export function checkMemberChange(config:AccessConfig,actor:string,email:string) {
  if(owners(config).includes(email))throw new HttpError(403,'Recovery owners are managed in deployment settings.');
  if(actor===email)throw new HttpError(403,'You cannot change your own access. Ask another owner.');
}
