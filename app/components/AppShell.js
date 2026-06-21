'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ADMIN_NAV, titleForPath } from '../../lib/adminNav';
import LogoutButton from './LogoutButton';
import MobileAppHeader from './MobileAppHeader';
import MobileBottomNav from './MobileBottomNav';
import MobileNavIcon from './MobileNavIcon';

export default function AppShell({ user, children }) {
  const pathname = usePathname();
  const topbarTitle = titleForPath(pathname);

  return (
    <div className="app-shell">
      <aside className="sidebar desktop-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-inner">
            <Image src="/logo.png" alt="Boxing Center" width={140} height={36} className="brand-logo" priority />
            <small className="brand-role">Compta Boxing</small>
          </div>
        </div>

        <div className="sidebar-nav">
          {ADMIN_NAV.map((section) => (
            <div
              key={section.label}
              className={['nav-section', section.sectionClass || ''].filter(Boolean).join(' ')}
            >
              <div className="nav-section-label">{section.label}</div>
              <div className="nav-section-links">
                {section.links.map((link) => {
                  const active =
                    pathname === link.href ||
                    (link.href !== '/admin' && pathname.startsWith(link.href));
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={[active ? 'active' : '', link.featured ? 'nav-link-featured' : '']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {link.icon ? (
                        <span className="nav-link-icon" aria-hidden="true">
                          <MobileNavIcon name={link.icon} active={active} />
                        </span>
                      ) : null}
                      <span className="nav-link-text">{link.text}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="sidebar-user-label">Session</span>
            <strong>{user?.email || '—'}</strong>
          </div>
          <LogoutButton />
        </div>
      </aside>

      <div className="app-main">
        <MobileAppHeader />

        <header className="app-topbar desktop-topbar">
          <h2 className="topbar-title">{topbarTitle}</h2>
          <div className="topbar-user">{user?.email}</div>
        </header>

        <main className="main app-main-content">{children}</main>

        <MobileBottomNav pathname={pathname} />
      </div>
    </div>
  );
}
