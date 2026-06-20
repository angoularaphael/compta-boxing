'use client';

import { useCallback, useEffect, useState } from 'react';
import { BOTS } from '../../../lib/bot-config';
import { parseApiJson } from '../../../lib/apiJson';
import ActionButton from '../../components/ActionButton';
import { useSingleAction } from '../../../lib/useSingleAction';
import { fetchBotStatusDirect, postBotActionDirect } from './bot-client';

function BotCard({ bot }) {
  const [status, setStatus] = useState({ loading: true });
  const [tick, setTick] = useState(0);
  const [qrMode, setQrMode] = useState(false);
  const [botUrl, setBotUrl] = useState(null);
  const { run: runStart, pending: starting } = useSingleAction();
  const { run: runStop, pending: stopping } = useSingleAction();
  const { run: runLogout, pending: loggingOut } = useSingleAction();

  const load = useCallback(async () => {
    setStatus((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch(`/api/bots/${bot.slug}`, { cache: 'no-store' });
      const config = await parseApiJson(res);
      if (!res.ok) throw new Error(config.error);

      const url = config.botUrl || null;
      setBotUrl(url);

      if (!config.configured || !url) {
        setStatus({
          loading: false,
          configured: false,
          connected: false,
          connecting: false,
          qr: null,
          error: 'URL du bot non configurée (Supabase bot_url ou BOT_URL_* sur Vercel).',
        });
        return;
      }

      const live = await fetchBotStatusDirect(url);
      setStatus({
        loading: false,
        slug: config.slug,
        label: config.label,
        botUrl: url,
        ...live,
      });
      if (live.connected) {
        setQrMode(false);
      } else if (live.connecting) {
        setQrMode(true);
      }
    } catch (err) {
      setStatus({ loading: false, error: err.message, connected: false, qr: null });
    }
  }, [bot.slug]);

  useEffect(() => {
    load();
  }, [load, tick]);

  useEffect(() => {
    if (status.connected) return undefined;
    if (!qrMode && !status.connecting) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 4000);
    return () => clearInterval(id);
  }, [status.connected, qrMode, status.connecting]);

  async function start() {
    if (starting || !botUrl) return;
    await runStart(async () => {
      setQrMode(true);
      try {
        await postBotActionDirect(botUrl, 'start');
        setStatus((s) => ({
          ...s,
          loading: false,
          connecting: true,
          error: null,
          qr: null,
        }));
      } catch (err) {
        setQrMode(false);
        setStatus((s) => ({
          ...s,
          loading: false,
          qr: null,
          connecting: false,
          error: err.message || 'Bot inaccessible.',
        }));
      } finally {
        setTick((t) => t + 1);
      }
    });
  }

  async function stop() {
    if (stopping || !botUrl) return;
    await runStop(async () => {
      try {
        await postBotActionDirect(botUrl, 'stop');
      } catch {
        /* ignore */
      }
      setQrMode(false);
      setStatus((s) => ({
        ...s,
        connecting: false,
        qr: null,
        error: null,
        qrError: null,
      }));
      setTick((t) => t + 1);
    });
  }

  async function logout() {
    if (loggingOut || !botUrl) return;
    await runLogout(async () => {
      try {
        await postBotActionDirect(botUrl, 'logout');
      } catch {
        /* ignore */
      }
      setQrMode(false);
      setTick((t) => t + 1);
    });
  }

  const showQr = qrMode && !status.connected && status.qr;
  const showWaiting = qrMode && !status.connected && !status.qr;
  const showConnecting = qrMode && !status.connected && status.connecting && !status.qr;

  return (
    <div className="card compta-bot-card">
      <div className="compta-bot-card-head">
        <h3>{bot.label}</h3>
        {status.loading ? (
          <span className="badge">Chargement…</span>
        ) : status.connected ? (
          <span className="badge badge-compta-ok">WhatsApp connecté ✓</span>
        ) : qrMode && status.connecting ? (
          <span className="badge">Connexion…</span>
        ) : (
          <span className="badge badge-compta-warn">À connecter</span>
        )}
      </div>

      {!status.loading && status.connected ? (
        <p className="muted">Le numéro WhatsApp de cette salle est prêt. Le client peut envoyer ses factures en photo.</p>
      ) : null}

      {showQr ? (
        <div className="compta-qr-wrap">
          <p><strong>Scannez ce QR code</strong> avec le téléphone du numéro WhatsApp de cette salle :</p>
          <p className="muted">WhatsApp → ⋮ → Appareils connectés → Connecter un appareil</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={status.qr} alt={`QR WhatsApp ${bot.label}`} className="compta-qr-img" />
        </div>
      ) : null}

      {!status.loading && !status.connected && !showQr ? (
        <div className="compta-bot-help">
          {status.qrError ? <p className="error">{status.qrError}</p> : null}
          <p>
            {showConnecting
              ? 'QR scanné — finalisation de la connexion…'
              : showWaiting
                ? (status.error || 'Génération du QR en cours…')
                : (status.error || 'Cliquez sur « Générer le QR » pour afficher le code.')}
          </p>
          {!qrMode && status.configured === false ? (
            <ol className="compta-steps">
              <li>Sur Bothosting : lancer le bot (index.js + .env)</li>
              <li>Dans Supabase : renseigner <code>bot_url</code> pour cette salle</li>
              <li>Ou sur Vercel : variable <code>{`BOT_URL_${bot.slug.toUpperCase()}`}</code></li>
            </ol>
          ) : null}
        </div>
      ) : null}

      <div className="compta-bot-actions">
        {!status.connected && !qrMode ? (
          <ActionButton type="button" className="btn ik-generate-btn" onClick={start} loading={starting} disabled={!botUrl && !status.loading}>
            {starting ? 'Démarrage…' : 'Générer le QR'}
          </ActionButton>
        ) : null}
        {!status.connected && qrMode ? (
          <ActionButton type="button" className="btn btn-secondary" onClick={stop} loading={stopping}>
            {stopping ? 'Fermeture…' : 'Fermer'}
          </ActionButton>
        ) : null}
        {status.connected ? (
          <ActionButton type="button" className="btn btn-secondary btn-small" onClick={logout} loading={loggingOut}>
            {loggingOut ? 'Déconnexion…' : 'Déconnecter'}
          </ActionButton>
        ) : null}
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
            Pour chaque salle : <strong>Générer le QR</strong> → scanner → attendre <strong>WhatsApp connecté ✓</strong>.
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
