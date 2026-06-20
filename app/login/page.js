'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ActionButton from '../components/ActionButton';
import PasswordField from '../components/PasswordField';
import { useSingleAction } from '../../lib/useSingleAction';

export default function LoginPage() {
  const router = useRouter();
  const { run, pending: loading } = useSingleAction();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    if (loading) return;

    setError('');
    await run(
      async () => {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur');
        router.push('/admin');
        router.refresh();
      },
      { resetOnSuccess: false }
    ).catch((err) => setError(err.message));
  }

  return (
    <div className="ik-login-page">
      <div className="ik-login-bg" aria-hidden="true" />
      <div className="ik-login-shell">
        <aside className="ik-login-brand">
          <Image src="/logo.svg" alt="Boxing Center" width={220} height={62} className="ik-login-logo" priority />
          <h1>Compta Boxing</h1>
          <p>Factures d&apos;achat — 3 salles</p>
          <ul className="ik-login-features">
            <li>Collecte WhatsApp par salle</li>
            <li>Rapprochement relevé bancaire</li>
            <li>Export mensuel pour le comptable</li>
          </ul>
        </aside>

        <div className="ik-login-card">
          <h2>Connexion</h2>
          <p className="ik-login-lead">Accédez à votre espace sécurisé</p>
          <form onSubmit={onSubmit} className={loading ? 'login-form--locked' : undefined}>
            <div className="form-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                placeholder="vous@exemple.fr"
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="password">Mot de passe</label>
              <PasswordField
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
            </div>
            {error && <p className="error">{error}</p>}
            <ActionButton type="submit" className="btn ik-login-submit" loading={loading}>
              {loading ? 'Connexion…' : 'Se connecter'}
            </ActionButton>
          </form>
        </div>
      </div>
    </div>
  );
}
