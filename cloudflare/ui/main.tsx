import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QrCode, ArrowUpRight, ShieldCheck } from 'lucide-react';
import Dashboard from '../../src/components/dashboard';
import '../../src/app/globals.css';
import '../../src/app/brand-theme.css';
import './png-downloads';
function Signin() {
  const error = new URLSearchParams(location.search).get('error');
  // Navigate rather than submit a form: Chrome applies form-action 'self' to
  // the OAuth endpoint's redirect to Google and would block that submission.
  return <main className="signin"><section className="signin-story"><div className="brand"><QrCode size={32}/><span className="brand-name">Capre<em>QR</em></span><span className="brand-dot"/></div><div><span className="eyebrow">ONE LINK. ENDLESS POSSIBILITIES.</span><h1>Small square.<br/><em>Lasting connection.</em></h1><p>Create a connection that stays. Manage your organization’s QR codes, update their destinations, and see how they perform.</p></div><p className="subtle">Built for your organization. Open to everyone who scans.</p></section><section className="signin-form"><span className="badge"><ShieldCheck size={14}/> STAFF ACCESS</span><h2>Your workspace awaits.</h2><p>Sign in with your approved Google account to manage organization links.</p>{error && <p className="error" role="alert">Sign-in unsuccessful. Use an approved staff account, or contact your administrator.</p>}<a className="primary google" href="/api/auth/signin/google"><span className="google-g" aria-hidden>G</span>Continue with Google<ArrowUpRight size={18}/></a><p className="fine">Access is limited to approved staff. People scanning your QR codes never need to sign in.</p></section></main>;
}
function App() {
  const [email,setEmail] = useState(''), [error,setError] = useState('');
  const signin = location.pathname === '/signin';
  useEffect(()=>{
    if (signin) return;
    fetch('/api/auth/session',{cache:'no-store'}).then(async r=>{ if(r.status===401){location.assign('/signin');return;}if(!r.ok)throw new Error('Workspace unavailable. Check your connection and try again.');setEmail((await r.json()).email); }).catch(e=>setError(e.message));
  },[signin]);
  if (signin) return <Signin/>;
  if (error) return <main className="loading-page"><h1>Workspace unavailable</h1><p role="alert">{error}</p><button className="primary" onClick={()=>location.reload()}>Try again</button></main>;
  if (!email) return <main className="loading-page" role="status">Opening your workspace…</main>;
  const params = new URLSearchParams(location.search);
  return <Dashboard actor={email} initialView={params.get('view') || 'overview'} initialId={params.get('id') || undefined} signOutAction={async()=>{const r=await fetch('/api/auth/signout',{method:'POST'});if(!r.ok)throw new Error('Sign-out failed. Try again.');location.assign('/signin');}}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
