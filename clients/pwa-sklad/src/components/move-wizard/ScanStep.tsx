// HolyOS PWA — scan step (materiál nebo lokace).

import { lazy, Suspense, useState, type FormEvent } from 'react';
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner';
import { lookupLocationByQr, lookupMaterialByQr, NotFoundError } from '../../sync/lookup';
import type { CachedLocation, CachedMaterial } from '../../db/schema';

// Lazy — zxing bundle (~200 KB) se stáhne až uživatel klikne 📷 Kamera.
const CameraScanner = lazy(() => import('../CameraScanner'));

interface BaseProps {
  title: string;
  subtitle?: string;
  onBack: () => void;
  onCancel: () => void;
}

interface MaterialProps extends BaseProps {
  target: 'material';
  onResolved: (item: CachedMaterial, source: 'api' | 'cache') => void;
}

interface LocationProps extends BaseProps {
  target: 'location';
  onResolved: (item: CachedLocation, source: 'api' | 'cache') => void;
}

type Props = MaterialProps | LocationProps;

export default function ScanStep(props: Props) {
  const { title, subtitle, target, onBack, onCancel } = props;

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  async function resolve(rawCode: string) {
    const trimmed = rawCode.trim();
    if (!trimmed) return;
    setError(null);
    setLoading(true);
    try {
      if (target === 'material') {
        const result = await lookupMaterialByQr(trimmed);
        (props as MaterialProps).onResolved(result.material, result.source);
      } else {
        const result = await lookupLocationByQr(trimmed);
        (props as LocationProps).onResolved(result.location, result.source);
      }
      setCode('');
    } catch (err) {
      if (err instanceof NotFoundError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Neznámá chyba');
      }
    } finally {
      setLoading(false);
    }
  }

  useBarcodeScanner({
    onScan: resolve,
    enabled: !cameraOpen && !loading,
  });

  async function handleManualSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await resolve(code);
  }

  function handleCameraScan(scanned: string) {
    setCameraOpen(false);
    resolve(scanned);
  }

  const placeholder =
    target === 'material' ? 'QR nebo kód materiálu' : 'QR nebo kód lokace';

  return (
    <>
      <div className="wizard-step">
        <header className="wizard-step-head">
          <div className="wizard-kicker">{target === 'material' ? 'Materiál' : 'Lokace'}</div>
          <h2 className="wizard-step-title">{title}</h2>
          {subtitle && <p className="wizard-step-sub">{subtitle}</p>}
        </header>

        <div className="wizard-scan-illo" aria-hidden="true">
          <div className="wizard-scan-frame" />
          <div className="wizard-scan-pulse">
            {target === 'material' ? '▦' : '▣'}
          </div>
        </div>

        <p className="wizard-hint">
          Naskenujte kód čtečkou. Můžete také použít kameru nebo kód opsat.
        </p>

        <form className="wizard-manual" onSubmit={handleManualSubmit}>
          <input
            className="field-input"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={placeholder}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={loading}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || code.trim().length === 0}
          >
            {loading ? '…' : 'Ověřit'}
          </button>
        </form>

        {error && <div className="alert alert-error" role="alert">{error}</div>}

        <div className="wizard-actions">
          <button type="button" className="btn" onClick={() => setCameraOpen(true)} disabled={loading}>
            📷 Kamera
          </button>
          <button type="button" className="btn btn-ghost" onClick={onBack}>
            ← Zpět
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Zrušit
          </button>
        </div>
      </div>

      {cameraOpen && (
        <Suspense fallback={<div className="camera-overlay"><div className="camera-hint">Načítám kameru…</div></div>}>
          <CameraScanner
            title={target === 'material' ? 'Naskenujte materiál' : 'Naskenujte lokaci'}
            onScan={handleCameraScan}
            onClose={() => setCameraOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
