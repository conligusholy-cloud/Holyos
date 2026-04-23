// HolyOS PWA — seznam otevřených dávek k vychystání.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listBatches, type BatchSummary } from '../api/batches';
import { ApiError } from '../api/client';

export default function PickingListPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<BatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [open, picking] = await Promise.all([
          listBatches('open'),
          listBatches('picking'),
        ]);
        if (cancelled) return;
        // merge a dedup podle id (pro jistotu), seřadit: picking nahoru,
        // uvnitř podle created_at desc
        const all = [...picking, ...open];
        const dedup = Array.from(new Map(all.map((b) => [b.id, b])).values());
        setItems(dedup);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Nepodařilo se načíst dávky');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="screen">
      <header className="topbar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
          ← Zpět
        </button>
        <div className="topbar-title">Picking</div>
        <span />
      </header>

      <main className="screen-body">
        {loading && <div className="placeholder-desc">Načítám…</div>}
        {error && <div className="alert alert-error">{error}</div>}

        {!loading && !error && items.length === 0 && (
          <div className="placeholder-card">
            <h2 className="placeholder-title">Žádné otevřené dávky</h2>
            <p className="placeholder-desc">
              Nové dávky se zakládají ve webovém rozhraní HolyOS (modul Dávky).
            </p>
          </div>
        )}

        <ul className="list">
          {items.map((b) => (
            <li
              key={b.id}
              className="list-card"
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/picking/${b.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') navigate(`/picking/${b.id}`);
              }}
            >
              <div className="list-card-head">
                <div>
                  <div className="list-card-title">{b.number}</div>
                  <div className="list-card-meta">
                    {b.sector && <span>{b.sector}</span>}
                    {b._count && <span>{b._count.items} položek</span>}
                    {b.assignee && (
                      <span>
                        {b.assignee.first_name} {b.assignee.last_name}
                      </span>
                    )}
                  </div>
                </div>
                <span className={`status-badge status-${b.status}`}>{b.status}</span>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
