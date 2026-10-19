import { auth, signOut } from '@/auth';
import { staffActor } from '@/lib/access';
import { redirect } from 'next/navigation';
import Dashboard from '@/components/dashboard';
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string; id?: string }> }) {
  const actor = staffActor(await auth()); if (!actor) redirect('/signin');
  const params = await searchParams;
  return <Dashboard actor={actor} initialView={params.view || 'overview'} initialId={params.id} signOutAction={async () => { 'use server'; await signOut({ redirectTo: '/signin' }); }} />;
}
