// HolyOS PWA — rozdělený pick přes víc šarží.
//
// Kdy použít: když materiál má expirable/distinguish_batches a žádná jednotlivá
// šarže nemá dost stocku na zdrojové lokaci pro celé requested množství.
// Operátor rozdělí pick mezi víc šarží (např. 2 ks z LOT-A + 3 ks z LOT-B = 5).
//
// Pro MVP online-only — rozdělený pick není v pick_queue (online ale užitečný).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getBatch,
  numberOrZero,
  pickBatchItemSplit,
  type BatchItem,
  type PickSplit,
} from '../api/batches';
import { ApiError } from '../api/client';
import { listLotsForMaterial, type MaterialLot } from '../api/lots';

interface Candidate {
  lot: MaterialLot;
  available: number;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('cs-CZ'); } catch { return iso; }
}
function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);
}

function generateClientUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  const rnd = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${rnd()}${rnd()}-${rnd()}-4${rnd().slice(1)}-${rnd()}-${rnd()}${rnd()}${rnd()}`;
}

export default function PickingSplitPage() {
  const navigate = useNavigate();
  const { id, itemId } = useParams<{ id: string; itemId: string }>();
  const batchId = Number(id);
  const batchItemId = Number(itemId);

  const [uuidPrefix] = useState(() => generateClientUuid());

  const [item, setItem] = useState<BatchItem | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const batch = await getBatch(batchId);
      const foundItem = batch.items.find((it) => it.id === batchItemId) ?? null;
      if (!foundItem) {
        setError('Položka nenalezena');
        setLoading(false);
        return;
      }
      if (foundItem.status !== 'pending') {
        setError(`Položka je ve stavu „${foundItem.status}" — nelze pickovat.`);
        setItem(foundItem);
        setLoading(false);
        return;
      }
      setItem(foundItem);

      const sourceLocId = foundItem.from_location_id;
      if (!sourceLocId) {
        setError('Položka nemá definovanou zdrojovou lokaci — split nelze použít bez ní. Vrať se a zadej lokaci v běžném pick.');
        setLoading(false);
        return;
      }

      const lots = await listLotsForMaterial(foundItem.material_id, { status: 'in_stock' });
      const cand: Candidate[] = [];
      for (const lot of lots) {
        const row = (lot.stock_rows ?? []).find(
          (r) => Number(r.location_id) === sourceLocId && Number(r.quantity) > 0
        );
        if (row) {
          cand.push({ lot, available: Number(row.quantity) });
        }
      }
      cand.sort((a, b) => {
        const ax = a.lot.expires_at ? new Date(a.lot.expires_at).getTime() : Infinity;
        const bx = b.lot.expires_at ? new Date(b.lot.expires_at).getTime() : Infinity;
        return ax - bx;
      });
      setCandidates(cand);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nepodařilo se načíst');
    } finally {
      setLoading(false);
    }
  }, [batchId, batchItemId]);

  useEffect(() => {
    if (Number.isFinite(batchId) && Number.isFinite(batchItemId)) load();
  }, [batchId, batchItemId, load]);

  const total = useMemo(() => {
    return candidates.reduce((sum, c) => {
      const v = Number(amounts[c.lot.id]);
      return sum + (Number.isFinite(v) ? v : 0);
    }, 0);
  }, [candidates, amounts]);

  function updateAmount(lotId: number, value: string) {
    setAmounts((prev) => ({ ...prev, [lotId]: value }));
  }

  async function submit() {
    if (!item) return;
    setError(null);

    const splits: PickSplit[] = [];
    for (const c of candidates) {
      const raw = amounts[c.lot.id] ?? '';
      const v = Number(raw);
      if (!Number.isFinite(v) || v <= 0) continue;
      if (v > c.available) {
        setError(`Šarže ${c.lot.lot_code} má jen ${c.available}, nelze vzít ${v}.`);
        return;
      }
      splits.push({
        lot_id: c.lot.id,
        quantity: v,
        from_location_id: item.from_location_id ?? undefined,
      });
    }
    if (splits.length === 0) {
      setError('Zadej aspoň jeden split s kladným množstvím.');
      return;
    }

    setSubmitting(true);
    try {
      await pickBatchItemSplit(batchId, {
        batch_item_id: batchItemId,
        client_uuid_prefix: uuidPrefix,
        splits,
      });
      navigate(`/picking/${batchId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Split se nepodařil');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="fullscreen-center"><div className="spinner" /></div>;
  }

  if (!item) {
    return (
      <div className="screen">
        <header className="topbar">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/picking/${batchId}`)}>← Položky</button>
          <div className="topbar-title">Split</div>
          <span />
        </header>
        <main className="screen-body">
          {error && <div className="alert alert-error">{error}</div>}
        </main>
      </div>
    );
  }

  const requested = numberOrZero(item.quantity);
  const material = item.material;

  return (
    <div className="screen">
      <header className="topbar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/picking/${batchId}/items/${batchItemId}`)}>
          ← Zpět
        </button>
        <div className="topbar-title">Rozdělit pick</div>
        <span />
      </header>

      <main className="screen-body">
        {error && <div className="alert alert-error">{error}</div>}

        <section className="wizard-step-head">
          <div className="wizard-kicker">Split přes šarže</div>
          <h2 className="wizard-step-title">{material?.name ?? `Materiál #${item.material_id}`}</h2>
          <p className="wizard-step-sub">
            {material?.code}{material?.unit ? ` · ${material.unit}` : ''}
          </p>
          <p className="wizard-hint">
            Požadováno: <strong>{requested}{material?.unit ? ` ${material.unit}` : ''}</strong>
          </p>
        </section>

        {candidates.length === 0 ? (
          <div className="placeholder-card">
            <h2 className="placeholder-title">Žádné šarže na lokaci</h2>
            <p className="placeholder-desc">
              Na zdrojové lokaci nejsou žádné in_stock šarže. Přijmi novou šarži
              nebo zkus běžný pick (pro nešaržované zásoby).
            </p>
          </div>
        ) : (
          <>
            <ul className="list">
              {candidates.map((c) => {
                const dl = daysLeft(c.lot.expires_at);
                const expDate = fmtDate(c.lot.expires_at);
                const dlTxt = dl == null ? '' : dl < 0 ? `prošlá ${Math.abs(dl)} d.` : `za ${dl} d.`;
                const dlClass = dl != null && dl <= 30 ? 'list-card-diff is-down' : 'list-card-meta';
                return (
                  <li key={c.lot.id} className="list-card">
                    <div className="list-card-head">
                      <div>
                        <div className="list-card-title">{c.lot.lot_code}</div>
                        <div className="list-card-meta">
                          <span>Exp. {expDate}</span>
                          {dlTxt && <span className={dlClass}>{dlTxt}</span>}
                          <span>Skladem {c.available}</span>
                        </div>
                      </div>
                      <input
                        type="number"
                        min="0"
                        max={c.available}
                        step="0.001"
                        inputMode="decimal"
                        className="field-input"
                        style={{ width: 100 }}
                        value={amounts[c.lot.id] ?? ''}
                        onChange={(e) => updateAmount(c.lot.id, e.target.value)}
                        placeholder="0"
                      />
                    </div>
                  </li>
                );
              })}
            </ul>

            <section className="debug-card" style={{ marginTop: 12 }}>
              <div className="list-card-head">
                <div className="list-card-title">
                  Celkem zvoleno:{' '}
                  <span className="summary-qty">
                    {total.toLocaleString('cs-CZ', { maximumFractionDigits: 3 })}
                  </span>
                  {' / '}{requested}
                </div>
              </div>
            </section>

            <div className="wizard-actions">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={submit}
                disabled={submitting || total <= 0}
              >
                {submitting ? 'Odesílám…' : 'Odeslat split'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => navigate(`/picking/${batchId}/items/${batchItemId}`)}
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
