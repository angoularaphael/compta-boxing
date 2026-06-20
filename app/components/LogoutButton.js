'use client';

import MobileNavIcon from './MobileNavIcon';
import ActionButton from './ActionButton';
import { useSingleAction } from '../../lib/useSingleAction';

export default function LogoutButton({ variant = 'full' }) {
  const { run, pending: loading } = useSingleAction();

  async function onLogout() {
    if (loading) return;
    await run(
      async () => {
        try {
          sessionStorage.removeItem('bc_compta_splash_seen');
          await fetch('/api/auth/logout', { method: 'POST' });
        } catch {
          /* redirection même en cas d'erreur réseau */
        }
        window.location.href = '/login';
      },
      { resetOnSuccess: false }
    );
  }

  if (variant === 'icon') {
    return (
      <ActionButton
        className="mobile-icon-btn mobile-icon-btn--danger"
        aria-label="Déconnexion"
        onClick={onLogout}
        loading={loading}
      >
        <MobileNavIcon name="logout" />
      </ActionButton>
    );
  }

  return (
    <ActionButton className="btn-logout" onClick={onLogout} loading={loading}>
      {loading ? 'Déconnexion…' : 'Déconnexion'}
    </ActionButton>
  );
}
