'use client';

import Image from 'next/image';

export default function WelcomeSplash({ phase }) {
  const exiting = phase === 'exit';

  return (
    <div className={`welcome-splash ${exiting ? 'welcome-splash--exit' : ''}`} aria-hidden={exiting}>
      <div className="welcome-splash__bg" />
      <div className="welcome-splash__glow welcome-splash__glow--a" />
      <div className="welcome-splash__glow welcome-splash__glow--b" />

      <div className="welcome-splash__content">
        <div className="welcome-splash__logo-wrap">
          <Image
            src="/logo.svg"
            alt="Boxing Center"
            width={220}
            height={62}
            className="welcome-splash__logo"
            priority
          />
        </div>

        <p className="welcome-splash__eyebrow">Bienvenue dans</p>
        <h1 className="welcome-splash__title">
          Compta Boxing
          <span>4 salles</span>
        </h1>
        <p className="welcome-splash__tagline">Factures & rapprochement bancaire</p>

        <div className="welcome-splash__loader" role="presentation">
          <span className="welcome-splash__loader-bar" />
        </div>
      </div>
    </div>
  );
}
