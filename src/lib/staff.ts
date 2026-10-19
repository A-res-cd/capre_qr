import { db } from './db';
import { HttpError } from './errors';
import { checkMemberChange, configuredMember, effectiveMember, memberInput, roster, type Member, type Role } from './staff-policy';
const config=()=>({STAFF_EMAILS:process.env.STAFF_EMAILS,OWNER_EMAILS:process.env.OWNER_EMAILS});
const member=(r:{email:string;role:string;active:boolean;version:number;updatedAt:Date}):Member=>({...r,role:r.role as Role,updatedAt:r.updatedAt.toISOString(),configured:false});
export async function membership(email:string) {
  email=email.toLowerCase();const c=config(),configured=configuredMember(c,email);
  if(configured?.configured)return configured;
  const row=await db.staffMember.findUnique({where:{email}});
  return effectiveMember(c,email,row?member(row):null);
}
export async function staffActor(session:{user?:{email?:string|null};verifiedStaff?:boolean}|null) {
  const email=session?.user?.email?.toLowerCase();
  return session?.verifiedStaff && email && (await membership(email))?.active ? email : null;
}
async function requireOwner(actor:string) {
  const current=await membership(actor);
  if(!current?.active||current.role!=='OWNER')throw new HttpError(403,'Only owners can manage staff access.');
}
export async function staffList(actor:string) {
  await requireOwner(actor);
  const [rows,history]=await Promise.all([db.staffMember.findMany(),db.auditLog.findMany({where:{action:{startsWith:'staff.'}},orderBy:{createdAt:'desc'},take:50})]);
  return {members:roster(config(),rows.map(member)),history};
}
export async function saveMember(actor:string,body:unknown) {
  await requireOwner(actor);const value=memberInput.parse(body);checkMemberChange(config(),actor,value.email);
  try{return await db.$transaction(async tx=>{
    const previous=await tx.staffMember.findUnique({where:{email:value.email}});
    if((previous?.version||0)!==value.version)throw new HttpError(409,'Staff access changed. Refresh and try again.');
    const before=effectiveMember(config(),value.email,previous?member(previous):null);
    if(previous){const updated=await tx.staffMember.updateMany({where:{email:value.email,version:value.version},data:{role:value.role,active:value.active,version:{increment:1}}});if(!updated.count)throw new HttpError(409,'Staff access changed. Refresh and try again.');}
    else await tx.staffMember.create({data:{email:value.email,role:value.role,active:value.active}});
    const after=member((await tx.staffMember.findUnique({where:{email:value.email}}))!);
    await tx.auditLog.create({data:{actor,action:'staff.updated',changes:{before,after}}});return after;
  });}catch(error){if((error as {code?:string}).code==='P2002')throw new HttpError(409,'Staff access changed. Refresh and try again.');throw error;}
}
