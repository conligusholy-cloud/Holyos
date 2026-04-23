// HolyOS PWA — detail dávky s položkami k vychystání.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getBatch, numberOrZero, type BatchDetail, type BatchItem } from '../api/batches';
import { ApiError } from '../api/client';

const STATUS_LABEL: Record<BatchItem['status'], string> = {
  pending: 'Čeká',
  picked: 'Napickováno',
  short: 'Částečně',
  skipped: 'Přeskočeno',
};

export default function PickingDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const batchId = Number(id);

  const [data, setData] = useState<BatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getBatch(batchId);
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nepodařilo se načíst');
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    if (Number.isFinite(batchId)) load();
  }, [batchId, load]);

  if (loading) {
    return <div className="fullscreen-center"><div className="spinner" /></div>;
  }
  if (!data) {
    return (
      <div className="screen">
        <header className="topbar">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/picking')}>
            ← Seznam
          </button>
          <div className="topbar-title">Dávka</div>
          <span />
        </header>
        <main className="screen-body">
          {error && <div className="alert alert-error">{error}</div>}
        </main>
      </div>
    );
  }

  const items = data.items;
  const done = items.filter((it) => it.status !== 'pending').length;
  const percent = items.length > 0 ? Math.round((done / items.length) * 100) : 0;
  const isDone = data.status === 'done';

  return (
    <div className="screen">
      <header className="topbar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/picking')}>
          ← Seznam
        </button>
        <div className="topbar-title">{data.number}</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={load}>↻</button>
      </header>

      <main className="screen-body">
        {error && <div className="alert alert-error">{error}</div>}

        <section className="debug-card">
          <div className="list-card-head">
            <div>
              <div className="list-card-title">
                {done} / {items.length} položek
              </div>
              <div className="list-card-meta">
                <span className={`status-badge status-${data.status}`}>{data.status}</span>
                {data.sector && <span>{data.sector}</span>}
              </div>
            </div>
            <div className="progress-ring">{percent}%</div>
          </div>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
          </div>
          {data.note && <div className="placeholder-desc">{data.note}</div>}
        </section>

        <ul className="list">
          {items.map((it) => {
            const qty = numberOrZero(it.quantity);
            const picked = it.picked_quantity != null ? numberOrZero(it.picked_quantity) : null;
            const pending = it.status === 'pending';

            return (
              <li
                key={it.id}
                className={`list-card is-${it.status}`}
                role="button"
                tabIndex={0}
                aria-disabled={!pending || isDone}
                onClick={() => {
                  if (!pending || isDone) return;
                  navigate(`/picking/${batchId}/items/${it.id}`);
                }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && pending && !isDone) {
                    navigate(`/picking/${batchId}/items/${it.id}`);
                  }
                }}
              >
                <div className="list-card-head">
                  <div>
                    <div className="list-card-title">
                      {it.material?.name ?? `Materiál #${it.material_id}`}
                    </div>
                    <div className="list-card-meta">
                      <span>{it.material?.code}</span>
                      {it.from_location && <span>{it.from_location.label}</span>}
                      <span>požad.: {qty}{it.material?.unit ? ` ${it.material.unit}` : ''}</span>
                    </div>
                  </div>
                  <div className="list-card-value">
                    {pending ? (
                      <span className="list-card-todo">Vychystat →</span>
                    ) : (
                      <>
                        <span className="list-card-qty">
                          {picked}{it.material?.unit ? ` ${it.material.unit}` : ''}
                        </span>
                        <span className={`status-badge status-item-${it.status}`}>
                          {STATUS_LABEL[it.status]}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {isDone && (
          <div className="alert alert-info" style={{ marginTop: '16px' }}>
            Dávka je uzavřená — další pickování není možné.
          </div>
        )}
      </main>
    </div>
  );
}
