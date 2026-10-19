import type { Metadata } from 'next';
import './globals.css';
import './brand-theme.css';
export const metadata: Metadata = { title: 'CapreQR · Organization links', description: 'Permanent QR links and anonymous request analytics.', robots: { index: false, follow: false } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
