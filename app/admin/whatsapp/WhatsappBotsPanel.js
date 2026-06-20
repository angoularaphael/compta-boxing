'use client';

import { useCallback, useEffect, useState } from 'react';
import { BOTS } from '../../../lib/bot-config';
import { parseApiJson } from '../../../lib/apiJson';
import ActionButton from '../../components/ActionButton';
import { useSingleAction } from '../../../lib/useSingleAction';

function BotCard({ bot }) {
  const [status, setStatus] = useState({ loading: true });
  const [tick, setTick] = useState(0);
  const { run: runStart, pending: starting } = useSingleAction();
  const { run: runLogout, pending: loggingOut } = useSingleAction();

  const load = useCallback(async () => {
    setStatus((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch(`/api/bots/${bot.slug}`, { cache: 'no-store' });
      const data = await parseApiJson(res);
      if (!res.ok) throw new Error(data.error);
      setStatus({ loading: false, ...data });
    } catch (err) {
      setStatus({ loading: false, error: err.message, connected: false, qr: null });
    }
  }, [bot.slug]);

  useEffect(() => {
    load();
  }, [load, tick]);

  useEffect(() => {
    if (status.connected) return undefined;
    const delay = status.connecting || status.qr ? 4000 : 8000;
    const id = setInterval(() => setTick((t) => t + 1), delay);
    return () => clearInterval(id);
  }, [status.connected, status.connecting, status.qr]);

  async function start() {
    if (starting) return;
    await runStart(async () => {
      try {
        const res = await fetch(`/api/bots/${bot.slug}?action=start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: 'qr' }),
        });
        const data = await parseApiJson(res);
        if (!res.ok) {
          setStatus((s) => ({ ...s, error: data.error || 'Échec du démarrage' }));
        } else {
          setStatus((s) => ({ ...s, connecting: true, error: null }));
        }
      } catch (err) {
        setStatus((s) => ({
          ...s,
          error: String(err.message || err).includes('abort')
            ? 'Délai dépassé — le bot démarre peut-être en arrière-plan, attendez le QR.'
            : 'Bot inaccessible.',
        }));
      } finally {
        setTick((t) => t + 1);
      }
    });
  }

  async function logout() {
    if (loggingOut) return;
    await runLogout(async () => {
      try {
        await fetch(`/api/bots/${bot.slug}?action=logout`, { method: 'POST' });
      } catch {
        /* ignore */
      }
      setTick((t) => t + 1);
    });
  }

  return (
    <div className="card compta-bot-card">
      <div className="compta-bot-card-head">
        <h3>{bot.label}</h3>
        {status.loading ? (
          <span className="badge">Chargement…</span>
        ) : status.connected ? (
          <span className="badge badge-compta-ok">WhatsApp connecté ✓</span>
        ) : status.connecting ? (
          <span className="badge">Connexion…</span>
        ) : (
          <span className="badge badge-compta-warn">À connecter</span>
        )}
      </div>

      {!status.loading && status.connected ? (
        <p className="muted">Le numéro WhatsApp de cette salle est prêt. Le client peut envoyer ses factures en photo.</p>
      ) : null}

      {!status.loading && !status.connected && status.qr ? (
        <div className="compta-qr-wrap">
          <p><strong>Scannez ce QR code</strong> avec le téléphone du numéro WhatsApp de cette salle :</p>
          <p className="muted">WhatsApp → ⋮ → Appareils connectés → Connecter un appareil</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={status.qr} alt={`QR WhatsApp ${bot.label}`} className="compta-qr-img" />
        </div>
      ) : null}

      {!status.loading && !status.connected && !status.qr ? (
        <div className="compta-bot-help">
          <p>
            {status.error
              || (status.connecting
                ? 'Génération du QR en cours…'
                : 'Cliquez sur « Générer le QR » pour afficher le code.')}
          </p>
          {!status.connecting && status.configured === false ? (
            <ol className="compta-steps">
              <li>Sur Bothosting : lancer le bot (index.js + .env)</li>
              <li>Dans Supabase : renseigner <code>bot_url</code> pour cette salle</li>
              <li>Ou sur Vercel : variable <code>{`BOT_URL_${bot.slug.toUpperCase()}`}</code></li>
            </ol>
          ) : null}
        </div>
      ) : null}

      <div className="compta-bot-actions">
        {!status.connected ? (
          <ActionButton type="button" className="btn ik-generate-btn" onClick={start} loading={starting}>
            {starting ? 'Démarrage…' : 'Générer le QR'}
          </ActionButton>
        ) : (
          <ActionButton type="button" className="btn btn-secondary btn-small" onClick={logout} loading={loggingOut}>
            {loggingOut ? 'Déconnexion…' : 'Déconnecter'}
          </ActionButton>
        )}
        <button type="button" className="btn btn-secondary btn-small" onClick={load} disabled={status.loading}>
          Actualiser
        </button>
      </div>
    </div>
  );
}

export default function WhatsappBotsPanel() {
  return (
    <div className="compta-panel ik-generator">
      <div className="ik-generator-hero">
        <div>
          <p className="ik-generator-eyebrow">Étape 0 — une seule fois</p>
          <h1>Connecter les 3 WhatsApp</h1>
          <p className="ik-generator-lead">
            Pour chaque salle, cliquez sur <strong>Générer le QR</strong>, puis scannez le code avec le téléphone WhatsApp du client.
          </p>
        </div>
      </div>

      <div className="card compta-guide">
        <h3 style={{ marginTop: 0 }}>Comment ça marche pour le client ?</h3>
        <ol className="compta-steps compta-steps--big">
          <li>Il <strong>photographie</strong> une facture avec son téléphone</li>
          <li>Il l&apos;envoie sur <strong>le bon numéro WhatsApp</strong> (Bot 1, 2 ou 3)</li>
          <li>Le bot répond « Facture reçue » — c&apos;est tout</li>
        </ol>
      </div>

      <div className="compta-bots-grid">
        {BOTS.map((bot) => (
          <BotCard key={bot.slug} bot={bot} />
        ))}
      </div>
    </div>
  );
}
