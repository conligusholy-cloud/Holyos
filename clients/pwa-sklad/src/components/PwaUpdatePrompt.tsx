// HolyOS PWA — banner pro nabídku obnovení na novou verzi.
//
// Využívá hook z `virtual:pwa-register/react` (poskytovaný vite-plugin-pwa).
// V dev módu (SW disabled) se nic nezobrazí.

import { useRegisterSW } from 'virtual:pwa-register/react';

export default function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl) {
      // Každou hodinu zkontroluj, jestli není nová verze (nezáleží na tom,
      // jestli je SW zaregistrovaný, prostě fetchne manifest).
      if (!swUrl) return;
      setInterval(() => {
        fetch(swUrl, { cache: 'no-cache' }).catch(() => undefined);
      }, 60 * 60 * 1000);
    },
  });

  function close() {
    setNeedRefresh(false);
    setOfflineReady(false);
  }

  if (!needRefresh && !offlineReady) return null;

  return (
    <div className="pwa-toast" role="status">
      <div className="pwa-toast-body">
        {needRefresh
          ? 'Je dostupná nová verze aplikace.'
          : 'Aplikace je připravena pro offline použití.'}
      </div>
      <div className="pwa-toast-actions">
        {needRefresh && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => updateServiceWorker(true)}
          >
            Obnovit
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
          Zavřít
        </button>
      </div>
    </div>
  );
}
