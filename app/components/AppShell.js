'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ADMIN_NAV } from '../../lib/adminNav';

export default function AppShell({ user, children }) {
  const pathname = usePathname();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Compta Boxing</h1>
        <p className="muted" style={{ color: '#94a3b8', margin: 0 }}>
          Minimes · États-Unis · St-Cyprien · Ramonville
        </p>
        <nav>
          {ADMIN_NAV.flatMap((s) =>
            s.links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link key={link.href} href={link.href} className={active ? 'active' : ''}>
                  {link.text}
                </Link>
              );
            })
          )}
        </nav>
        <div className="sidebar-footer">
          <div>{user?.email}</div>
          <button type="button" className="btn btn-secondary btn-small" onClick={logout} style={{ marginTop: '0.5rem' }}>
            Déconnexion
          </button>
        </div>
      </aside>
      <div className="main">{children}</div>
    </div>
  );
}
