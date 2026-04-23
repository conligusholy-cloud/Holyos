// HolyOS PWA — seznam aktivních inventur.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listInventories, type InventorySummary } from '../api/inventory';
import { ApiError } from '../api/client';

export default function InventoryListPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<InventorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const all = await listInventories();
        if (cancelled) return;
        // PWA zobrazuje jen aktivní — dokončené se historizují ve web UI
        const active = all.filter((i) => i.status === 'in_progress' || i.status === 'draft');
        setItems(active);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Nepodařilo se načíst inventury');
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
        <div className="topbar-title">Inventura</div>
        <span />
      </header>

      <main className="screen-body">
        {loading && <div className="placeholder-desc">Načítám…</div>}
        {error && <div className="alert alert-error">{error}</div>}

        {!loading && !error && items.length === 0 && (
          <div className="placeholder-card">
            <h2 className="placeholder-title">Žádná aktivní inventura</h2>
            <p className="placeholder-desc">
              Nová inventura se zakládá ve webovém rozhraní HolyOS.
            </p>
          </div>
        )}

        <ul className="list">
          {items.map((inv) => (
            <li
              key={inv.id}
              className="list-card"
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/inventory/${inv.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') navigate(`/inventory/${inv.id}`);
              }}
            >
              <div className="list-card-head">
                <div className="list-card-title">
                  {inv.name ?? `Inventura #${inv.id}`}
                </div>
                <span className={`status-badge status-${inv.status}`}>{inv.status}</span>
              </div>
              <div className="list-card-meta">
                <span>Sklad #{inv.warehouse_id}</span>
                {inv.started_at && (
                  <span>Zahájeno {new Date(inv.started_at).toLocaleDateString('cs-CZ')}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
