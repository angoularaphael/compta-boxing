import Image from 'next/image';
import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="ik-login-page">
      <div className="ik-login-bg" aria-hidden="true" />
      <div className="ik-login-shell ik-landing-shell">
        <aside className="ik-login-brand">
          <Image src="/logo.png" alt="Boxing Center" width={220} height={56} className="ik-login-logo" priority />
          <h1>Compta Boxing</h1>
          <p>Factures d&apos;achat — 3 salles Boxing Center</p>
          <ul className="ik-login-features">
            <li>Collecte WhatsApp par salle</li>
            <li>Rapprochement relevé bancaire</li>
            <li>Export mensuel pour le comptable</li>
          </ul>
        </aside>

        <div className="ik-login-card ik-landing-card">
          <h2>Espace comptable</h2>
          <p className="ik-login-lead">
            Centralisez les factures d&apos;achat, vérifiez le rapprochement bancaire et exportez le dossier mensuel.
          </p>
          <Link href="/login" className="btn ik-login-submit ik-landing-cta">
            Se connecter
          </Link>
          <p className="ik-landing-footer">
            <a href="https://boxingcenter.fr/" target="_blank" rel="noreferrer">
              boxingcenter.fr
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
