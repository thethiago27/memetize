'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Library' },
  { href: '/projects', label: 'Projects' },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          data-active={
            link.href === '/' ? pathname === '/' : pathname.startsWith(link.href) ? 'true' : 'false'
          }
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
