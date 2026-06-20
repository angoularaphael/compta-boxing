'use client';

import { useCallback, useEffect, useState } from 'react';
import { BOTS } from '../../../lib/bot-config';
import { parseApiJson } from '../../../lib/apiJson';

function BotCard({ bot }) {
  const [status, setStatus] = useState({ loading: true });
  const [tick, setTick] = useState(0);

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
    const id = setInterval(() => setTick((t) => t + 1), 8000);
    return () => clearInterval(id);
  }, [status.connected]);

  return (
    <div className="card compta-bot-card">
      <div className="compta-bot-card-head">
        <h3>{bot.label}</h3>
        {status.loading ? (
          <span className="badge">Chargement…</span>
        ) : status.connected ? (
          <span className="badge badge-compta-ok">WhatsApp connecté ✓</span>
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
          <p>{status.error || 'QR code pas encore disponible.'}</p>
          <ol className="compta-steps">
            <li>Sur Bothosting : lancer le bot (index.js + .env)</li>
            <li>Dans Supabase : renseigner <code>bot_url</code> pour cette salle</li>
            <li>Ou sur Vercel : variable <code>{`BOT_URL_${bot.slug.toUpperCase().replace('ST_', 'ST_')}`}</code> (ex. BOT_URL_MINIMES)</li>
          </ol>
        </div>
      ) : null}

      <button type="button" className="btn btn-secondary btn-small" onClick={load} disabled={status.loading}>
        Actualiser
      </button>
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
            Chaque salle a son propre numéro. Scannez le QR code pour que le client puisse envoyer ses factures en photo.
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
