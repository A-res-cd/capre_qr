import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { membership } from '@/lib/staff';
const allowedEmail=async(email?:string|null)=>!!email && !!(await membership(email))?.active;
declare module 'next-auth' { interface Session { verifiedStaff?: boolean } }
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  pages: { signIn: '/signin', error: '/signin' },
  callbacks: {
    async signIn({ account, profile }) {
      return account?.provider === 'google' && profile?.email_verified === true && await allowedEmail(profile.email);
    },
    async jwt({ token, account, profile }) {
      if (account) token.verifiedStaff = account.provider === 'google' && profile?.email_verified === true && await allowedEmail(profile.email);
      return token;
    },
    async session({ session, token }) {
      session.verifiedStaff = token.verifiedStaff === true && await allowedEmail(session.user?.email);
      return session;
    },
  },
});
