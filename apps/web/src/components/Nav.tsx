'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  {
    href: '/',
    label: 'Projetos',
    match: (path: string) => path === '/' || path.startsWith('/projects'),
  },
  {
    href: '/library',
    label: 'Biblioteca',
    match: (path: string) => path.startsWith('/library') || path.startsWith('/assets'),
  },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          data-active={link.match(pathname) ? 'true' : 'false'}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
