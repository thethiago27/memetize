import type { Metadata } from 'next';
import { Barlow_Condensed, Figtree, IBM_Plex_Mono } from 'next/font/google';
import Link from 'next/link';
import { ApiLamp } from '../components/ApiLamp';
import { Nav } from '../components/Nav';
import './globals.css';

const slate = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600', '800'],
  variable: '--font-slate',
});

const body = Figtree({
  subsets: ['latin'],
  variable: '--font-body',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Memetize bay',
  description: 'Local edit bay for music-to-meme timelines',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${slate.variable} ${body.variable} ${mono.variable}`}>
        <div className="shell">
          <header className="mast">
            <Link className="wordmark" href="/">
              Meme<span>tize</span>
            </Link>
            <div className="mast-end">
              <Nav />
              <ApiLamp />
            </div>
          </header>
          <main className="page">{children}</main>
        </div>
      </body>
    </html>
  );
}
