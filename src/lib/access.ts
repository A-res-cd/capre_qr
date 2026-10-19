export function allowedEmail(email?: string | null) {
  const allowed = (process.env.STAFF_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return !!email && allowed.includes(email.toLowerCase());
}
export function staffActor(session: { user?: { email?: string | null }; verifiedStaff?: boolean } | null) {
  return session?.verifiedStaff && allowedEmail(session.user?.email) ? session.user!.email!.toLowerCase() : null;
}
