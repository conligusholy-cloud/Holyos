// HolyOS PWA — Kontrola stavu.
// Jeden vstup, dva režimy podle toho, co se naskenuje:
//   • Materiál (mat-{id} / barcode) → kde leží, kolik, varování pod minimem
//   • Lokace   (sto-{wh}-{code} / barcode) → co na ní je, jaká množství
// Nezapisuje žádné pohyby.

import { lazy, Suspense, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import {
  lookupLocationByQr,
  lookupMaterialByQr,
  NotFoundError,
  type LocationLookupResult,
  type MaterialLookupResult,
} from '../sync/lookup';

const CameraScanner = lazy(() => import('../components/CameraScanner'));

// Detekuje, jestli QR začíná prefixem lokace — `sto-...`.
function isLocationQr(raw: string): boolean {
  return /^sto-/i.test(raw.trim());
}

// Stock row na lokaci: { quantity, material: { id, code, name, unit } }
interface LocationStockRow {
  quantity: number | string;
  material?: { id: number; code: string; name: string; unit: string | null };
}

function pluralItems(n: number): string {
  if (n === 1) return 'položka';
  if (n >= 2 && n <= 4) return 'položky';
  return 'položek';
}

export default function StockCheckPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [materialResult, setMaterialResult] = useState<MaterialLookupResult | null>(null);
  const [locationResult, setLocationResult] = useState<LocationLookupResult | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  async function resolve(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setError(null);
    setLoading(true);
    setMaterialResult(null);
    setLocationResult(null);
    try {
      if (isLocationQr(trimmed)) {
        const r = await lookupLocationByQr(trimmed);
        setLocationResult(r);
      } else {
        // Materiál první — pokrývá mat-{id} i legacy EAN přes fallback.
        // Při 404 ještě zkusíme lokaci (barcode nálepky bez sto- prefixu).
        try {
          const r = await lookupMaterialByQr(trimmed);
          setMaterialResult(r);
        } catch (err) {
          if (err instanceof NotFoundError) {
            try {
              const rl = await lookupLocationByQr(trimmed);
              setLocationResult(rl);
            } catch {
              throw err;
            }
          } else {
            throw err;
          }
        }
      }
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
    setMaterialResult(null);
    setLocationResult(null);
    setError(null);
    setCode('');
  }

  function handleCameraScan(scanned: string) {
    setCameraOpen(false);
    void resolve(scanned);
  }

  // ---- Výsledek: MATERIÁL ----
  if (materialResult) {
    const m = materialResult.material;
    const underMin = m.min_stock != null && Number(m.current_stock) < Number(m.min_stock);
    const stock = materialResult.stockByLocation ?? [];

    return (
      <div className="screen">
        <header className="topbar">
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/')}>
            ← Domů
          </button>
          <div className="topbar-user">
            <div className="topbar-user-name">Kontrola stavu</div>
          </div>
        </header>

        <main className="screen-body">
          <div className="wizard-step">
            <header className="wizard-step-head">
              <div className="wizard-kicker">Materiál · SKU {m.code}</div>
              <h2 className="wizard-step-title">{m.name}</h2>
              {m.unit && <p className="wizard-step-sub">Jednotka: {m.unit}</p>}
            </header>

            <div className="summary-main" style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 48, fontWeight: 700 }}>
                {Number(m.current_stock).toLocaleString('cs-CZ')} {m.unit ?? ''}
              </div>
              <div className="summary-sub">
                {m.min_stock != null
                  ? `Minimum: ${Number(m.min_stock).toLocaleString('cs-CZ')} ${m.unit ?? ''}`
                  : 'Bez minima'}
              </div>
            </div>

            {underMin && (
              <div className="alert alert-error" role="alert">
                ⚠ Zásoba je pod minimem.
              </div>
            )}

            {materialResult.source === 'cache' && (
              <div className="alert alert-info" role="status">
                Offline režim — zobrazuji poslední známá data z cache.
              </div>
            )}

            <h3 style={{ marginTop: 24, marginBottom: 8 }}>Kde leží</h3>
            {stock.length === 0 ? (
              <p className="wizard-step-sub">Na žádné lokaci není evidováno.</p>
            ) : (
              <div className="list">
                {stock.map((row, i) => (
                  <div className="list-card" key={i}>
                    <div className="list-card-head">
                      <div className="list-card-title">
                        {row.location?.label ?? `Lokace #${row.location_id ?? '—'}`}
                      </div>
                      <div className="list-card-qty">
                        {Number(row.quantity).toLocaleString('cs-CZ')} {m.unit ?? ''}
                      </div>
                    </div>
                    {row.location?.type && (
                      <div className="list-card-meta">{row.location.type}</div>
                    )}
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

  // ---- Výsledek: LOKACE ----
  if (locationResult) {
    const loc = locationResult.location;
    const wh = (loc as unknown as { warehouse?: { name: string; code: string | null } }).warehouse;
    const rows = ((loc as unknown as { stock?: LocationStockRow[] }).stock) ?? [];
    const totalItems = rows.length;

    return (
      <div className="screen">
        <header className="topbar">
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/')}>
            ← Domů
          </button>
          <div className="topbar-user">
            <div className="topbar-user-name">Kontrola stavu</div>
          </div>
        </header>

        <main className="screen-body">
          <div className="wizard-step">
            <header className="wizard-step-head">
              <div className="wizard-kicker">Lokace{wh ? ` · ${wh.name}` : ''}</div>
              <h2 className="wizard-step-title">{loc.label}</h2>
              {loc.type && <p className="wizard-step-sub">{String(loc.type)}</p>}
            </header>

            <div className="summary-main" style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 48, fontWeight: 700 }}>{totalItems}</div>
              <div className="summary-sub">{pluralItems(totalItems)}</div>
            </div>

            {locationResult.source === 'cache' && (
              <div className="alert alert-info" role="status">
                Offline režim — cache neobsahuje detail zásob na lokaci.
              </div>
            )}

            <h3 style={{ marginTop: 24, marginBottom: 8 }}>Co na ní je</h3>
            {rows.length === 0 ? (
              <p className="wizard-step-sub">Lokace je prázdná.</p>
            ) : (
              <div className="list">
                {rows.map((row, i) => (
                  <div className="list-card" key={i}>
                    <div className="list-card-head">
                      <div className="list-card-title">
                        {row.material?.name ?? `Materiál #${i}`}
                      </div>
                      <div className="list-card-qty">
                        {Number(row.quantity).toLocaleString('cs-CZ')} {row.material?.unit ?? ''}
                      </div>
                    </div>
                    {row.material?.code && (
                      <div className="list-card-meta">SKU {row.material.code}</div>
                    )}
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
          <div className="topbar-user-name">Kontrola stavu</div>
        </div>
      </header>

      <main className="screen-body">
        <div className="wizard-step">
          <header className="wizard-step-head">
            <div className="wizard-kicker">Materiál nebo lokace</div>
            <h2 className="wizard-step-title">Naskenujte QR</h2>
            <p className="wizard-step-sub">Materiál → kde leží. Lokace → co na ní je.</p>
          </header>

          <div className="wizard-scan-illo" aria-hidden="true">
            <div className="wizard-scan-frame" />
            <div className="wizard-scan-pulse">▦</div>
          </div>

          <p className="wizard-hint">
            Naskenujte QR čtečkou (mat-123 nebo sto-1-A04A), nebo kód opište ručně.
          </p>

          <form className="wizard-manual" onSubmit={handleManualSubmit}>
            <input
              className="field-input"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="QR materiálu nebo lokace"
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
            title="Naskenujte QR"
            onScan={handleCameraScan}
            onClose={() => setCameraOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
