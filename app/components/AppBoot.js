'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import WelcomeSplash from './WelcomeSplash';
import { registerServiceWorker } from '../../lib/pwa';

const SPLASH_MS = 2800;
const EXIT_MS = 650;

export default function AppBoot({ children }) {
  const pathname = usePathname();
  const [phase, setPhase] = useState('done');
  const isLogin = pathname === '/login';

  useEffect(() => {
    registerServiceWorker();
    if (isLogin) return undefined;

    const seen = sessionStorage.getItem('bc_compta_splash_seen');
    if (seen) return undefined;

    setPhase('show');
    const exitTimer = setTimeout(() => setPhase('exit'), SPLASH_MS);
    const doneTimer = setTimeout(() => {
      sessionStorage.setItem('bc_compta_splash_seen', '1');
      setPhase('done');
    }, SPLASH_MS + EXIT_MS);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(doneTimer);
    };
  }, [isLogin]);

  const hideApp = !isLogin && (phase === 'show' || phase === 'exit');

  return (
    <>
      {hideApp ? <WelcomeSplash phase={phase} /> : null}
      <div className={hideApp ? 'app-boot--behind-splash' : undefined}>{children}</div>
    </>
  );
}
