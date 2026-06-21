'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import MobileNavIcon from './MobileNavIcon';
import LogoutButton from './LogoutButton';

export default function MobileAppHeader() {
  const pathname = usePathname();

  return (
    <header className="mobile-app-header">
      <div className="mobile-app-brand">
        <Image src="/logo.png" alt="Boxing Center" width={110} height={28} className="mobile-brand-logo" priority />
        <span className="mobile-brand-tag mobile-brand-tag-neutral">COMPTA</span>
      </div>

      <div className="mobile-app-actions">
        <Link href="/admin/whatsapp" className="mobile-icon-btn" aria-label="WhatsApp">
          <MobileNavIcon name="whatsapp" active={pathname === '/admin/whatsapp'} />
        </Link>
        <Link href="/admin" className="mobile-icon-btn" aria-label="Factures">
          <MobileNavIcon name="dashboard" active={pathname === '/admin'} />
        </Link>
        <LogoutButton variant="icon" />
      </div>
    </header>
  );
}
