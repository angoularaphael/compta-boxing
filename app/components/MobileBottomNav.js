'use client';

import Link from 'next/link';
import { isTabActive, MOBILE_TABS } from '../../lib/mobileNav';
import MobileNavIcon from './MobileNavIcon';

export default function MobileBottomNav({ pathname }) {
  return (
    <nav className="mobile-bottom-nav" aria-label="Navigation principale">
      {MOBILE_TABS.map((tab) => {
        const active = isTabActive(pathname, tab.href, tab.exact);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`mobile-tab ${active ? 'active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <MobileNavIcon name={tab.icon} active={active} />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
