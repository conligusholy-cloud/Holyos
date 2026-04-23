// HolyOS PWA — pickovací obrazovka jedné položky dávky.
//
// Flow:
//   1. Pokud item nemá from_location_id, operátor musí nejprve naskenovat lokaci.
//      Jinak je lokace známá a sken je jen volitelné potvrzení.
//   2. Hardware/kamera scan materiálu → ověření proti item.material_id.
//   3. Numpad skutečně napickované množství (0 = skip, < qty = short, == qty = picked).
//   4. Submit s client_uuid (držený po celou dobu session — umožňuje bezpečné opakování).

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Numpad, { parseNumpad } from '../components/Numpad';
import {
  getBatch,
  numberOrZero,
  type BatchItem,
} from '../api/batches';
import { ApiError } from '../api/client';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import {
  lookupLocationByQr,
  lookupMaterialByQr,
  NotFoundError,
} from '../sync/lookup';
import type { CachedLocation } from '../db/schema';
import { enqueuePick } from '../db/pickQueueRepo';
import { useSync } from '../sync/SyncContext';

interface ResolvedLocation {
  id: number;
  label: string;
}

export default function PickingPickPage() {
  const navigate = useNavigate();
  const { id, itemId } = useParams<{ id: string; itemId: string }>();
  const batchId = Number(id);
  const batchItemId = Number(itemId);

  const { stats, flushQueue, refreshStats } = useSync();

  const [item, setItem] = useState<BatchItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [raw, setRaw] = useState('');
  const [locationOverride, setLocationOverride] = useState<ResolvedLocation | null>(null);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [materialConfirmed, setMaterialConfirmed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const batch = await getBatch(batchId);
      const found = batch.items.find((it) => it.id === batchItemId) ?? null;
      if (!found) {
        setError('Položka nenalezena');
      } else if (found.status !== 'pending') {
        setError(`Položka je ve stavu „${found.status}" — nelze pickovat.`);
        setItem(found);
      } else {
        setItem(found);
        // Pre-fill default množství na požadované (rychlejší "happy path")
        setRaw(String(numberOrZero(found.quantity)));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nepodařilo se načíst');
    } finally {
      setLoading(false);
    }
  }, [batchId, batchItemId]);

  useEffect(() => {
    if (Number.isFinite(batchId) && Number.isFinite(batchItemId)) load();
  }, [batchId, batchItemId, load]);

  const requiresLocationScan = !!item && !item.from_location_id && !locationOverride;

  useBarcodeScanner({
    onScan: async (code) => {
      setScanMsg(null);
      setScanError(null);
      if (!item) return;

      // Pokud ještě nemáme lokaci, zkusíme naskenovat ji.
      if (requiresLocationScan) {
        try {
          const result = await lookupLocationByQr(code);
          const loc: CachedLocation = result.location;
          setLocationOverride({ id: loc.id, label: loc.label });
          setScanMsg(`✓ Lokace: ${loc.label}`);
        } catch (err) {
          setScanError(err instanceof NotFoundError ? err.message : 'Chyba skenu lokace');
        }
        return;
      }

      // Jinak: ověření materiálu (nebo kontrola, jestli to není lokace).
      try {
        const result = await lookupMaterialByQr(code);
        if (result.material.id === item.material_id) {
          setMaterialConfirmed(true);
          setScanMsg(`✓ ${result.material.name} (${result.material.code})`);
        } else {
          setScanError(
            `Naskenovaný materiál "${result.material.name}" nesouhlasí s položkou.`
          );
        }
      } catch (err) {
        setScanError(err instanceof NotFoundError ? err.message : 'Chyba skenu materiálu');
      }
    },
    enabled: !saving,
  });

  async function submit(quantity: number) {
    if (!item) return;
    const loc = locationOverride?.id ?? item.from_location_id ?? null;
    if (quantity > 0 && !loc) {
      setError('Chybí zdrojová lokace — naskenujte ji.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Offline-safe: enqueue + (pokud online) okamžitý flush. auto_completed
      // bychom v offline neznali; proto prostě naviguj zpět na detail dávky,
      // kde se progressbar přepočítá z čerstvých dat.
      await enqueuePick({
        batch_id: batchId,
        batch_item_id: batchItemId,
        picked_quantity: quantity,
        from_location_id: loc,
      });
      await refreshStats();
      if (stats.online) {
        await flushQueue();
      }
      navigate(`/picking/${batchId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Uložení selhalo');
    } finally {
      setSaving(false);
    }
  }

  function handlePick() {
    const value = parseNumpad(raw);
    if (value == null || value <= 0) {
      setError('Zadejte kladné množství, nebo použijte „Přeskočit"');
      return;
    }
    submit(value);
  }

  function handleSkip() {
    const ok = window.confirm('Přeskočit tuto položku? (picked_quantity = 0)');
    if (!ok) return;
    submit(0);
  }

  if (loading) {
    return <div className="fullscreen-center"><div className="spinner" /></div>;
  }

  if (!item) {
    return (
      <div className="screen">
        <header className="topbar">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate(`/picking/${batchId}`)}
          >
            ← Položky
          </button>
          <div className="topbar-title">Pick</div>
          <span />
        </header>
        <main className="screen-body">
          {error && <div className="alert alert-error">{error}</div>}
        </main>
      </div>
    );
  }

  const material = item.material;
  const requested = numberOrZero(item.quantity);
  const locationLabel =
    locationOverride?.label ?? item.from_location?.label ?? null;

  return (
    <div className="screen">
      <header className="topbar">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => navigate(`/picking/${batchId}`)}
        >
          ← Položky
        </button>
        <div className="topbar-title">Vychystat</div>
        <span />
      </header>

      <main className="screen-body">
        {error && <div className="alert alert-error">{error}</div>}

        <section className="wizard-step-head">
          <div className="wizard-kicker">
            {requiresLocationScan ? 'Lokace chybí — naskenujte ji' : 'Položka dávky'}
          </div>
          <h2 className="wizard-step-title">{material?.name ?? `Materiál #${item.material_id}`}</h2>
          <p className="wizard-step-sub">
            {material?.code}
            {material?.unit ? ` · ${material.unit}` : ''}
          </p>
          <p className="wizard-hint">
            Požadováno: <strong>{requested}{material?.unit ? ` ${material.unit}` : ''}</strong>
            {locationLabel && (
              <>
                {' '}· Lokace: <strong>{locationLabel}</strong>
              </>
            )}
          </p>
        </section>

        {scanMsg && <div className="alert alert-info">{scanMsg}</div>}
        {scanError && <div className="alert alert-error">{scanError}</div>}
        {!materialConfirmed && !requiresLocationScan && (
          <div className="alert alert-info">
            Tip: naskenujte materiál pro ověření, že odebíráte to správné.
          </div>
        )}

        {!requiresLocationScan && (
          <Numpad value={raw} onChange={setRaw} unit={material?.unit ?? undefined} />
        )}

        <div className="wizard-actions">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={handlePick}
            disabled={saving || requiresLocationScan}
          >
            {saving ? 'Odesílám…' : 'Napickovat'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={handleSkip}
            disabled={saving || requiresLocationScan}
          >
            Přeskočit (0)
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate(`/picking/${batchId}`)}
            disabled={saving}
          >
            Zrušit
          </button>
        </div>
      </main>
    </div>
  );
}
