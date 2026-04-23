// HolyOS PWA — fullscreen scanner přes webkameru (fallback pro dev / telefon).
//
// SUNMI čtečky tohle nepotřebují — tam je hardware scan přes keyboard wedge
// (useBarcodeScanner). Tohle je pro:
//   1) vývoj na notebooku bez hardware scanneru
//   2) telefon / tablet bez dedikované čtečky
//
// Používá @zxing/browser s MultiFormatReader (QR, Code128, EAN, DataMatrix).

import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import type { IScannerControls } from '@zxing/browser';

interface Props {
  onScan: (code: string) => void;
  onClose: () => void;
  title?: string;
}

export default function CameraScanner({ onScan, onClose, title }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const firedRef = useRef(false); // aby první sken nesehrál dvakrát

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls: IScannerControls | null = null;
    let cancelled = false;

    (async () => {
      try {
        const devices = await BrowserMultiFormatReader.listVideoInputDevices();
        if (devices.length === 0) {
          throw new Error('Žádná kamera nebyla nalezena.');
        }
        // Preferuj zadní kameru (environment) — na mobilech je jako první ta
        // se slovem "back"/"rear"/"environment".
        const rear =
          devices.find((d) => /back|rear|environment/i.test(d.label)) ?? devices[0];

        if (!videoRef.current) return;

        controls = await reader.decodeFromVideoDevice(
          rear.deviceId,
          videoRef.current,
          (result) => {
            if (cancelled || firedRef.current) return;
            if (result) {
              firedRef.current = true;
              const code = result.getText();
              // Minimální vibrace jako hmatový feedback
              if ('vibrate' in navigator) navigator.vibrate(30);
              controls?.stop();
              onScan(code);
            }
          }
        );
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Kameru se nepodařilo spustit';
        setError(msg);
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [onScan]);

  return (
    <div className="camera-overlay" role="dialog" aria-modal="true">
      <div className="camera-header">
        <span className="camera-title">{title ?? 'Naskenujte kód'}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Zrušit
        </button>
      </div>

      <div className="camera-stage">
        <video ref={videoRef} className="camera-video" muted playsInline />
        <div className="camera-frame" aria-hidden="true" />
      </div>

      {error ? (
        <div className="camera-error">
          <div className="alert alert-error">{error}</div>
          <button type="button" className="btn" onClick={onClose}>
            Zavřít
          </button>
        </div>
      ) : (
        <div className="camera-hint">
          Zaměřte QR nebo čárový kód do rámečku.
        </div>
      )}
    </div>
  );
}
