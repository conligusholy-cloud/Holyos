// HolyOS PWA — detail inventury se seznamem položek.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  finishInventory,
  getInventory,
  numberOrZero,
  type InventoryDetail,
  type FinishInventoryResult,
} from '../api/inventory';
import { ApiError } from '../api/client';

export default function InventoryDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const invId = Number(id);

  const [data, setData] = useState<InventoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [result, setResult] = useState<FinishInventoryResult | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getInventory(invId);
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nepodařilo se načíst');
    } finally {
      setLoading(false);
    }
  }, [invId]);

  useEffect(() => {
    if (Number.isFinite(invId)) reload();
  }, [invId, reload]);

  async function handleFinish() {
    if (!data) return;
    const pendingCount = data.items.filter((it) => it.actual_qty == null).length;
    const confirmed = window.confirm(
      pendingCount > 0
        ? `Nespočítáno ${pendingCount} položek. Opravdu uzavřít inventuru? Tyto se přeskočí.`
        : 'Uzavřít inventuru a vygenerovat adjustační pohyby?'
    );
    if (!confirmed) return;

    setFinishing(true);
    setError(null);
    try {
      const res = await finishInventory(invId);
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Chyba při uzavírání');
    } finally {
      setFinishing(false);
    }
  }

  if (loading) {
    return <div className="fullscreen-center"><div className="spinner" /></div>;
  }

  if (result) {
    return (
      <div className="screen">
        <header className="topbar">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            ← Dashboard
          </button>
          <div className="topbar-title">Hotovo</div>
          <span />
        </header>
        <main className="screen-body">
          <div className="wizard-step wizard-step-success">
            <div className="wizard-success-icon">✓</div>
            <h2 className="wizard-step-title">Inventura uzavřena</h2>
            <p className="wizard-success-line">
              Vygenerováno {result.adjustments_count} adjustačních pohybů.
            </p>
            <p className="wizard-hint">
              Přeskočeno · bez lokace: {result.skipped.no_location} · nespočítáno:{' '}
              {result.skipped.no_actual} · beze změny: {result.skipped.no_diff}
            </p>
            <div className="wizard-actions">
              <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate('/inventory')}>
                Zpět na seznam
              </button>
              <button type="button" className="btn" onClick={() => navigate('/')}>
                Dashboard
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="screen">
        <header className="topbar">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/inventory')}>
            ← Seznam
          </button>
          <div className="topbar-title">Inventura</div>
          <span />
        </header>
        <main className="screen-body">
          {error && <div className="alert alert-error">{error}</div>}
        </main>
      </div>
    );
  }

  const items = data.items;
  const countedItems = items.filter((it) => it.actual_qty != null).length;
  const pendingItems = items.length - countedItems;
  const percent = items.length > 0 ? Math.round((countedItems / items.length) * 100) : 0;

  return (
    <div className="screen">
      <header className="topbar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/inventory')}>
          ← Seznam
        </button>
        <div className="topbar-title">{data.name ?? `Inventura #${data.id}`}</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>↻</button>
      </header>

      <main className="screen-body">
        {error && <div className="alert alert-error">{error}</div>}

        <section className="debug-card">
          <div className="list-card-head">
            <div>
              <div className="list-card-title">
                {countedItems} / {items.length} spočítáno
              </div>
              <div className="list-card-meta">
                <span>Zbývá {pendingItems}</span>
                <span>Sklad #{data.warehouse_id}</span>
              </div>
            </div>
            <div className="progress-ring">{percent}%</div>
          </div>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="debug-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleFinish}
              disabled={finishing || items.length === 0}
            >
              {finishing ? 'Uzavírám…' : 'Dokončit inventuru'}
            </button>
          </div>
        </section>

        <ul className="list">
          {items.map((it) => {
            const counted = it.actual_qty != null;
            const expected = numberOrZero(it.expected_qty);
            const actual = counted ? numberOrZero(it.actual_qty) : null;
            const diff = counted && actual != null ? actual - expected : null;

            return (
              <li
                key={it.id}
                className={`list-card ${counted ? 'is-counted' : 'is-pending'}`}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/inventory/${invId}/items/${it.id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    navigate(`/inventory/${invId}/items/${it.id}`);
                  }
                }}
              >
                <div className="list-card-head">
                  <div>
                    <div className="list-card-title">{it.material?.name ?? `Materiál #${it.material_id}`}</div>
                    <div className="list-card-meta">
                      <span>{it.material?.code}</span>
                      {it.location && <span>{it.location.label}</span>}
                      <span>očekáv.: {expected}{it.material?.unit ? ` ${it.material.unit}` : ''}</span>
                    </div>
                  </div>
                  <div className="list-card-value">
                    {counted ? (
                      <>
                        <span className="list-card-qty">{actual}</span>
                        {diff !== 0 && diff != null && (
                          <span className={`list-card-diff ${diff > 0 ? 'is-up' : 'is-down'}`}>
                            {diff > 0 ? `+${diff}` : diff}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="list-card-todo">Spočítat →</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
