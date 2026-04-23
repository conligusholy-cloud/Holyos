// HolyOS PWA — persistentní ID zařízení pro audit pohybů.
//
// Posílá se v headeru `X-Device-Id` s každým /api/wh/moves requestem;
// backend ho ukládá do `InventoryMovement.device_id`. ID vzniká při prvním
// spuštění PWA a žije v localStorage — přežije tvrdé zavření appky, padne
// jen s wipe dat prohlížeče (což je vzácné a chtěné, pak je to jiné zařízení).

const KEY = 'holyos.pwa.device_id';

function generate(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // fallback pro úzce omezená testovací prostředí
  const rnd = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${rnd()}${rnd()}-${rnd()}-4${rnd().slice(1)}-${rnd()}-${rnd()}${rnd()}${rnd()}`;
}

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = generate();
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Soukromý režim / zablokovaný storage — ID bude efektivně per-session.
    return generate();
  }
}

export function resetDeviceId(): string {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignorujeme
  }
  return getDeviceId();
}
