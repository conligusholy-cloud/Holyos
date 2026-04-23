// HolyOS PWA — odposlech hardware čtečky (keyboard wedge mode).
//
// SUNMI L2H/L3 ve výchozím nastavení posílá oskenovaný kód jako sekvenci
// keydown eventů zakončenou `Enter` (přesně jako rychlé psaní na klávesnici).
// Rozlišujeme hardware scan od lidského psaní podle rychlosti: mezi jednotlivými
// stisky musí být < 60 ms. Pokud má stránka aktivní text input, ponecháme
// uživateli možnost psát ručně a scan ignorujeme (input si Enter chytne sám).
//
// Hook vrátí nic — ty to používáš přes callback a interně si řeší cleanup.

import { useEffect, useRef } from 'react';

interface Options {
  onScan: (code: string) => void;
  minLength?: number;          // ignore kratší než tohle (zbytečný šum)
  interCharMaxMs?: number;     // max gap mezi chars, aby se counted as scan
  suspendWhenInputFocused?: boolean;
  enabled?: boolean;
}

const DEFAULT_MIN_LENGTH = 3;
const DEFAULT_INTER_CHAR_MAX_MS = 60;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export function useBarcodeScanner({
  onScan,
  minLength = DEFAULT_MIN_LENGTH,
  interCharMaxMs = DEFAULT_INTER_CHAR_MAX_MS,
  suspendWhenInputFocused = true,
  enabled = true,
}: Options): void {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    let buffer = '';
    let lastTime = 0;

    const handler = (event: KeyboardEvent) => {
      if (suspendWhenInputFocused && isEditableTarget(event.target)) {
        // Uživatel píše do inputu (numpad, login form). Scanner do inputu
        // napíše taky a Enter odešle form — to je ok, chceme tomu nepřekážet.
        return;
      }

      // Modifikátory → pustit dál, není scan
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const now = performance.now();
      const gap = lastTime === 0 ? 0 : now - lastTime;

      if (event.key === 'Enter') {
        if (buffer.length >= minLength && gap <= interCharMaxMs * 5) {
          const code = buffer;
          buffer = '';
          lastTime = 0;
          event.preventDefault();
          onScanRef.current(code);
        } else {
          buffer = '';
          lastTime = 0;
        }
        return;
      }

      // Ignoruj speciální klávesy (šipky, F1..., Shift sám o sobě, apod.)
      if (event.key.length !== 1) return;

      if (buffer.length > 0 && gap > interCharMaxMs) {
        // mezera mezi znaky moc velká → restart (nebyl to scan, user píše)
        buffer = '';
      }

      buffer += event.key;
      lastTime = now;
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [enabled, interCharMaxMs, minLength, suspendWhenInputFocused]);
}
