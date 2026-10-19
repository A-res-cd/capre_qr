import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { allowedEmail } from '@/lib/access';
declare module 'next-auth' { interface Session { verifiedStaff?: boolean } }
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  pages: { signIn: '/signin', error: '/signin' },
  callbacks: {
    signIn({ account, profile }) {
      return account?.provider === 'google' && profile?.email_verified === true && allowedEmail(profile.email);
    },
    jwt({ token, account, profile }) {
      if (account) token.verifiedStaff = account.provider === 'google' && profile?.email_verified === true && allowedEmail(profile.email);
      return token;
    },
    session({ session, token }) {
      session.verifiedStaff = token.verifiedStaff === true && allowedEmail(session.user?.email);
      return session;
    },
  },
});
