// HolyOS PWA — počítací obrazovka jednoho inventárního itemu.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Numpad, { parseNumpad } from '../components/Numpad';
import { getInventory, updateInventoryItem, numberOrZero, type InventoryItem } from '../api/inventory';
import { ApiError } from '../api/client';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { lookupMaterialByQr, NotFoundError } from '../sync/lookup';

export default function InventoryCountPage() {
  const navigate = useNavigate();
  const { id, itemId } = useParams<{ id: string; itemId: string }>();
  const invId = Number(id);
  const invItemId = Number(itemId);

  const [item, setItem] = useState<InventoryItem | null>(null);
  const [raw, setRaw] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const inv = await getInventory(invId);
      const found = inv.items.find((it) => it.id === invItemId) ?? null;
      if (!found) {
        setError('Položka nenalezena');
      } else {
        setItem(found);
        if (found.actual_qty != null) {
          setRaw(String(numberOrZero(found.actual_qty)));
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nepodařilo se načíst');
    } finally {
      setLoading(false);
    }
  }, [invId, invItemId]);

  useEffect(() => {
    if (Number.isFinite(invId) && Number.isFinite(invItemId)) load();
  }, [invId, invItemId, load]);

  // Scanner — ověření materiálu. Po naskenování najde materiál, porovná
  // s item.material_id; pokud sedí, jen status, jinak varování.
  useBarcodeScanner({
    onScan: async (code) => {
      setScanError(null);
      setConfirmMsg(null);
      if (!item) return;
      try {
        const result = await lookupMaterialByQr(code);
        if (result.material.id === item.material_id) {
          setConfirmMsg(`✓ ${result.material.name} (${result.material.code})`);
        } else {
          setScanError(
            `Pozor — naskenovaný materiál "${result.material.name}" nesouhlasí s položkou.`
          );
        }
      } catch (err) {
        setScanError(err instanceof NotFoundError ? err.message : 'Chyba skenu');
      }
    },
    enabled: !saving,
  });

  async function save() {
    if (!item) return;
    const value = parseNumpad(raw);
    if (value == null || value < 0) {
      setError('Zadejte nezáporné množství');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateInventoryItem(invId, invItemId, { actual_qty: value });
      navigate(`/inventory/${invId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Uložení selhalo');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="fullscreen-center"><div className="spinner" /></div>;
  }

  const material = item?.material;
  const location = item?.location;
  const expected = item ? numberOrZero(item.expected_qty) : 0;

  return (
    <div className="screen">
      <header className="topbar">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => navigate(`/inventory/${invId}`)}
        >
          ← Položky
        </button>
        <div className="topbar-title">Počítat</div>
        <span />
      </header>

      <main className="screen-body">
        {error && <div className="alert alert-error">{error}</div>}

        {item && material && (
          <>
            <section className="wizard-step-head">
              <div className="wizard-kicker">Položka inventury</div>
              <h2 className="wizard-step-title">{material.name}</h2>
              <p className="wizard-step-sub">
                {material.code}
                {material.unit ? ` · ${material.unit}` : ''}
                {location ? ` · ${location.label}` : ''}
              </p>
              <p className="wizard-hint">
                Očekávaný stav: <strong>{expected}{material.unit ? ` ${material.unit}` : ''}</strong>
              </p>
            </section>

            {confirmMsg && <div className="alert alert-info">{confirmMsg}</div>}
            {scanError && <div className="alert alert-error">{scanError}</div>}

            <Numpad value={raw} onChange={setRaw} unit={material.unit ?? undefined} />

            <div className="wizard-actions">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={save}
                disabled={saving}
              >
                {saving ? 'Ukládám…' : 'Uložit spočítané'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => navigate(`/inventory/${invId}`)}
              >
                Zrušit
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
