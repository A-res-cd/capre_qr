import { signIn, auth } from '@/auth';
import { staffActor } from '@/lib/staff';
import { redirect } from 'next/navigation';
import { QrCode, ArrowUpRight, ShieldCheck } from 'lucide-react';
export default async function Signin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await staffActor(await auth())) redirect('/dashboard');
  const { error } = await searchParams;
  const configured = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET && process.env.AUTH_SECRET);
  return <main className="signin"><section className="signin-story"><div className="brand"><QrCode size={32} /><span className="brand-name">Capre<em>QR</em></span><span className="brand-dot" /></div><div><span className="eyebrow">ONE LINK. ENDLESS POSSIBILITIES.</span><h1>Small square.<br /><em>Lasting connection.</em></h1><p>Create a connection that stays. Manage your organization’s QR codes, update their destinations, and see how they perform.</p></div><p className="subtle">Built for your organization. Open to everyone who scans.</p></section><section className="signin-form"><span className="badge"><ShieldCheck size={14} /> STAFF ACCESS</span><h2>Your workspace awaits.</h2><p>Sign in with your approved Google account to manage organization links.</p>{error && <p className="error" role="alert">Sign-in unsuccessful. Use an approved staff account, or contact your administrator.</p>}{!configured && <p className="notice">Setup needed: configure Google OAuth, AUTH_SECRET, and STAFF_EMAILS in the server environment. See README.md.</p>}<form action={async () => { 'use server'; await signIn('google', { redirectTo: '/dashboard' }); }}><button className="primary google" disabled={!configured}><span className="google-g" aria-hidden>G</span>Continue with Google<ArrowUpRight size={18} /></button></form><p className="fine">Access is limited to approved staff. People scanning your QR codes never need to sign in.</p></section></main>;
}
