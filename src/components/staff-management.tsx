'use client';
import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import type { Member, Role } from '../lib/staff-policy';
type History={id:string;actor:string;action:string;createdAt:string;changes:{before:Member|null;after:Member}};
async function request<T>(init?:RequestInit):Promise<T>{
  const response=await fetch('/api/manage/staff',{...init,cache:'no-store',headers:init?.body?{'Content-Type':'application/json'}:{}});
  if(response.status===401){location.assign('/signin');throw new Error('Sign in again to continue.');}
  const body=await response.json();if(!response.ok)throw new Error(body.error||'Unable to update staff access.');return body;
}
export default function StaffManagement({actor}:{actor:string}) {
  const [data,setData]=useState<{members:Member[];history:History[]}|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [email,setEmail]=useState(''),[role,setRole]=useState<Role>('STAFF'),[editing,setEditing]=useState<Member|null>(null),[revoke,setRevoke]=useState<Member|null>(null);
  const load=useCallback(async()=>{try{setError('');setData(await request());}catch(e){setError((e as Error).message);}},[]);
  useEffect(()=>{void load();},[load]);
  const reset=()=>{setEditing(null);setEmail('');setRole('STAFF');};
  async function save(member:Pick<Member,'email'|'role'|'active'|'version'>){
    setBusy(true);setError('');setNotice('');
    try{await request({method:'PUT',body:JSON.stringify(member)});reset();setRevoke(null);setNotice(member.active?'Staff access saved. They can sign in with their Google account.':'Access revoked. Existing sessions are blocked on their next request.');await load();}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <div className="staff-management">
    <section className="panel"><div className="panel-heading"><div><h2>Trusted accounts</h2><p>Owners manage access. Staff manage QR codes and reports.</p></div><button className="secondary" disabled={busy} onClick={load}><RefreshCw size={15}/>Refresh staff</button></div>
      <p className="fine padded"><ShieldCheck size={14}/> Added accounts use Google sign-in. Adding access does not send an email.</p>
      {error&&<p className="error padded" role="alert">{error}</p>}{notice&&<p className="notice padded" role="status">{notice}</p>}
      <form className="staff-access-form" onSubmit={e=>{e.preventDefault();void save({email:email.trim().toLowerCase(),role,active:editing?.active??true,version:editing?.version??0});}}>
        <label>Google email<input type="email" required maxLength={254} autoComplete="off" value={email} readOnly={!!editing} onChange={e=>setEmail(e.target.value)} placeholder="teammate@gmail.com"/></label>
        <label>Access role<select value={role} onChange={e=>setRole(e.target.value as Role)}><option value="STAFF">Staff</option><option value="OWNER">Owner</option></select></label>
        <button className="primary" disabled={busy}>{editing?'Save role':'Add trusted account'}{!editing&&<Plus size={16}/>}</button>
        {editing&&<button type="button" className="text-button" disabled={busy} onClick={reset}><X size={14}/>Cancel editing</button>}
      </form>
      {role==='OWNER'&&<p className="notice padded">Owners can grant or revoke access for other accounts.</p>}
      {!data?<p className="padded" role="status">Loading trusted accounts…</p>:<div className="table-wrap"><table><thead><tr><th>Google account</th><th>Role</th><th>Access</th><th>Actions</th></tr></thead><tbody>{data.members.map(m=><tr key={m.email}><td data-label="Account" className="staff-email">{m.email}{m.email===actor&&<small>You</small>}{m.configured&&<small>Recovery owner · deployment setting</small>}</td><td data-label="Role">{m.role==='OWNER'?'Owner':'Staff'}</td><td data-label="Access"><span className={`status ${m.active?'active':'paused'}`}><i/>{m.active?'Active':'Revoked'}</span></td><td data-label="Actions">{m.configured||m.email===actor?<span className="fine">Protected</span>:<div className="staff-actions"><button className="secondary" disabled={busy} aria-label={`Edit access for ${m.email}`} onClick={()=>{setEditing(m);setEmail(m.email);setRole(m.role);setError('');}}>Edit access</button>{m.active?<button className="text-button" disabled={busy} aria-label={`Revoke access for ${m.email}`} onClick={()=>setRevoke(m)}>Revoke access</button>:<button className="text-button" disabled={busy} aria-label={`Restore access for ${m.email}`} onClick={()=>save({email:m.email,role:m.role,active:true,version:m.version})}>Restore access</button>}</div>}</td></tr>)}</tbody></table></div>}
    </section>
    {revoke&&<section className="panel staff-confirm" role="region" aria-label="Confirm access revocation"><h2>Revoke access?</h2><p>{revoke.email} will lose access on their next request. Their QR codes and change history stay available.</p><div className="staff-actions"><button className="primary" disabled={busy} onClick={()=>save({email:revoke.email,role:revoke.role,active:false,version:revoke.version})}>Confirm revoke</button><button className="secondary" disabled={busy} onClick={()=>setRevoke(null)}>Cancel revocation</button></div></section>}
    {data&&<section className="panel audit"><div className="panel-heading"><div><h2>Access history</h2><p>Latest 50 staff access changes</p></div></div>{!data.history.length?<p className="fine padded">Access changes will appear here.</p>:data.history.map(h=><details key={h.id}><summary><span className="audit-dot"/><strong>{h.changes.after.active?'Access saved':'Access revoked'}</strong><span>{h.changes.after.email}</span><time>{new Date(h.createdAt).toLocaleString()}</time></summary><p className="padded">Changed by {h.actor} · {h.changes.after.role==='OWNER'?'Owner':'Staff'}</p></details>)}</section>}
  </div>;
}
