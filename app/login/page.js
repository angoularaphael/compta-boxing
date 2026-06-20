'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSingleAction } from '../../lib/useSingleAction';

export default function LoginPage() {
  const router = useRouter();
  const { run, pending } = useSingleAction();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    await run(async () => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      router.push('/admin');
      router.refresh();
    }).catch((err) => setError(err.message));
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Compta Boxing</h1>
        <p className="muted">Factures d&apos;achat — 4 salles</p>
        <form onSubmit={onSubmit}>
          <div className="form-field" style={{ marginBottom: '0.75rem' }}>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="form-field" style={{ marginBottom: '0.75rem' }}>
            <label htmlFor="password">Mot de passe</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn" type="submit" disabled={pending}>
            {pending ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}
