// HolyOS PWA — Informace o zboží.
// Read-only flow: naskenuj QR materiálu → plný detail + dodavatel, sektor,
// stock po lokacích a posledních 10 pohybů.

import { lazy, Suspense, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { lookupMaterialByQr, NotFoundError, type MaterialLookupResult } from '../sync/lookup';

const CameraScanner = lazy(() => import('../components/CameraScanner'));

const MOVEMENT_LABELS: Record<string, string> = {
  receipt: '📥 Příjem',
  issue: '📤 Výdej',
  transfer: '🔄 Převod',
  adjustment: '📝 Korekce',
  inventory_adjust: '✓ Inventura',
  reservation: '⏳ Rezervace',
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('cs-CZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// Backend vrací raw Material (kromě polí v CachedMaterial má i supplier, atd.)
interface ExtendedMaterial {
  supplier?: { id: number; name: string } | null;
  description?: string | null;
  price?: number | null;
  sales_price?: number | null;
  category?: string | null;
  [key: string]: unknown;
}

interface Movement {
  id: number;
  type: string;
  quantity: number | string;
  created_at?: string;
  location_id?: number | null;
  from_location_id?: number | null;
  to_location_id?: number | null;
}

export default function ItemInfoPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MaterialLookupResult | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  async function resolve(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setError(null);
    setLoading(true);
    try {
      const r = await lookupMaterialByQr(trimmed);
      setResult(r);
      setCode('');
    } catch (err) {
      if (err instanceof NotFoundError) setError(err.message);
      else if (err instanceof Error) setError(err.message);
      else setError('Neznámá chyba');
    } finally {
      setLoading(false);
    }
  }

  useBarcodeScanner({
    onScan: resolve,
    enabled: !cameraOpen && !loading,
  });

  function handleManualSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void resolve(code);
  }

  function handleAnother() {
    setResult(null);
    setError(null);
    setCode('');
  }

  function handleCameraScan(scanned: string) {
    setCameraOpen(false);
    void resolve(scanned);
  }

  if (result) {
    const m = result.material;
    const ext = m as unknown as ExtendedMaterial;
    const stock = result.stockByLocation ?? [];
    const moves = (result.lastMovements ?? []) as Movement[];

    return (
      <div className="screen">
        <header className="topbar">
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/')}>
            ← Domů
          </button>
          <div className="topbar-user">
            <div className="topbar-user-name">Info o zboží</div>
          </div>
        </header>

        <main className="screen-body">
          <div className="wizard-step">
            <header className="wizard-step-head">
              <div className="wizard-kicker">SKU {m.code}</div>
              <h2 className="wizard-step-title">{m.name}</h2>
            </header>

            {result.source === 'cache' && (
              <div className="alert alert-info" role="status">
                Offline režim — data z cache.
              </div>
            )}

            <dl className="wizard-summary">
              <dt>Jednotka</dt>
              <dd>{m.unit ?? '—'}</dd>
              <dt>Sektor</dt>
              <dd>{m.sector ?? '—'}</dd>
              <dt>QR / kód</dt>
              <dd>{m.barcode ?? '—'}</dd>
              <dt>Celkem na skladě</dt>
              <dd>
                {Number(m.current_stock).toLocaleString('cs-CZ')} {m.unit ?? ''}
              </dd>
              <dt>Minimum</dt>
              <dd>
                {m.min_stock != null
                  ? `${Number(m.min_stock).toLocaleString('cs-CZ')} ${m.unit ?? ''}`
                  : '—'}
              </dd>
              {ext.supplier && (
                <>
                  <dt>Dodavatel</dt>
                  <dd>{ext.supplier.name}</dd>
                </>
              )}
              {ext.category && (
                <>
                  <dt>Kategorie</dt>
                  <dd>{ext.category}</dd>
                </>
              )}
              {ext.price != null && (
                <>
                  <dt>Cena</dt>
                  <dd>
                    {Number(ext.price).toLocaleString('cs-CZ', {
                      style: 'currency',
                      currency: 'CZK',
                    })}
                  </dd>
                </>
              )}
            </dl>

            <h3 style={{ marginTop: 24, marginBottom: 8 }}>Lokace</h3>
            {stock.length === 0 ? (
              <p className="wizard-step-sub">Nikde neleží.</p>
            ) : (
              <div className="list">
                {stock.map((row, i) => (
                  <div className="list-card" key={i}>
                    <div className="list-card-head">
                      <div className="list-card-title">
                        {row.location?.label ?? `#${row.location_id ?? '—'}`}
                      </div>
                      <div className="list-card-qty">
                        {Number(row.quantity).toLocaleString('cs-CZ')} {m.unit ?? ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <h3 style={{ marginTop: 24, marginBottom: 8 }}>Poslední pohyby</h3>
            {moves.length === 0 ? (
              <p className="wizard-step-sub">Žádné pohyby.</p>
            ) : (
              <div className="list">
                {moves.map((mv) => (
                  <div className="list-card" key={mv.id}>
                    <div className="list-card-head">
                      <div className="list-card-title">
                        {MOVEMENT_LABELS[mv.type] ?? mv.type}
                      </div>
                      <div className="list-card-qty">
                        {Number(mv.quantity) > 0 ? '+' : ''}
                        {Number(mv.quantity).toLocaleString('cs-CZ')} {m.unit ?? ''}
                      </div>
                    </div>
                    <div className="list-card-meta">{formatDate(mv.created_at)}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="wizard-actions" style={{ marginTop: 24 }}>
              <button type="button" className="btn btn-primary" onClick={handleAnother}>
                Skenovat další
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => navigate('/')}>
                Hotovo
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ---- Scan režim ----
  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/')}>
          ← Domů
        </button>
        <div className="topbar-user">
          <div className="topbar-user-name">Info o zboží</div>
        </div>
      </header>

      <main className="screen-body">
        <div className="wizard-step">
          <header className="wizard-step-head">
            <div className="wizard-kicker">Materiál</div>
            <h2 className="wizard-step-title">Naskenujte zboží</h2>
            <p className="wizard-step-sub">Zobrazí plný detail — dodavatel, sektor, lokace, pohyby.</p>
          </header>

          <div className="wizard-scan-illo" aria-hidden="true">
            <div className="wizard-scan-frame" />
            <div className="wizard-scan-pulse">ℹ</div>
          </div>

          <p className="wizard-hint">
            Naskenujte QR čtečkou (kód mat-123), nebo kód opište ručně.
          </p>

          <form className="wizard-manual" onSubmit={handleManualSubmit}>
            <input
              className="field-input"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="QR nebo kód materiálu"
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
            <button
              type="button"
              className="btn"
              onClick={() => setCameraOpen(true)}
              disabled={loading}
            >
              📷 Kamera
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/')}>
              Zrušit
            </button>
          </div>
        </div>
      </main>

      {cameraOpen && (
        <Suspense
          fallback={
            <div className="camera-overlay">
              <div className="camera-hint">Načítám kameru…</div>
            </div>
          }
        >
          <CameraScanner
            title="Naskenujte materiál"
            onScan={handleCameraScan}
            onClose={() => setCameraOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
