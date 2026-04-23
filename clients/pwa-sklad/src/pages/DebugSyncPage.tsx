// HolyOS PWA — debug/stavová stránka synchronizace.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSync } from '../sync/SyncContext';
import { ApiError } from '../api/client';
import { getDeviceId } from '../device';
import { listFailed, listPending, deleteMove, revertToPending } from '../db/queueRepo';
import type { QueuedMove } from '../db/schema';

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('cs-CZ');
  } catch {
    return iso;
  }
}

export default function DebugSyncPage() {
  const navigate = useNavigate();
  const { stats, catalogBusy, queueBusy, refreshStats, refreshCatalog, flushQueue } = useSync();

  const [pending, setPending] = useState<QueuedMove[]>([]);
  const [failed, setFailed] = useState<QueuedMove[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadLists = useCallback(async () => {
    const [p, f] = await Promise.all([listPending(), listFailed()]);
    setPending(p);
    setFailed(f);
  }, []);

  useEffect(() => {
    reloadLists();
  }, [reloadLists, stats.pendingCount, stats.failedCount]);

  const handleSyncCatalog = async () => {
    setMessage(null);
    setError(null);
    try {
      const result = await refreshCatalog();
      setMessage(
        `Katalog načten · materiály ${result.materials.fetched} · lokace ${result.locations.fetched}`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Chyba');
    }
  };

  const handleResetCatalog = async () => {
    setMessage(null);
    setError(null);
    try {
      const result = await refreshCatalog({ reset: true });
      setMessage(
        `Full refresh · materiály ${result.materials.fetched} · lokace ${result.locations.fetched}`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Chyba');
    }
  };

  const handleFlush = async () => {
    setMessage(null);
    setError(null);
    try {
      const result = await flushQueue();
      setMessage(
        `Flush · pokus ${result.attempted} · nových ${result.synced} · dedup ${result.deduped} · selhalo ${result.failed} · čekají ${result.retrying}`
      );
      await reloadLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba flush');
    }
  };

  const handleRetryFailed = async (uuid: string) => {
    await revertToPending(uuid, null);
    await refreshStats();
    await reloadLists();
  };

  const handleDelete = async (uuid: string) => {
    await deleteMove(uuid);
    await refreshStats();
    await reloadLists();
  };

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')} type="button">
          ← Zpět
        </button>
        <div className="topbar-title">Synchronizace</div>
        <span />
      </header>

      <main className="screen-body debug-body">
        {message && <div className="alert alert-info" role="status">{message}</div>}
        {error && <div className="alert alert-error" role="alert">{error}</div>}

        <section className="debug-card">
          <h2 className="debug-card-title">Stav</h2>
          <dl className="debug-kv">
            <dt>Připojení</dt>
            <dd>
              <span className={stats.online ? 'dot-online' : 'dot-offline'}>●</span>{' '}
              {stats.online ? 'Online' : 'Offline'}
            </dd>
            <dt>Ve frontě</dt>
            <dd>{stats.pendingCount}</dd>
            <dt>Probíhá</dt>
            <dd>{stats.syncingCount}</dd>
            <dt>Selhalo</dt>
            <dd>{stats.failedCount}</dd>
          </dl>
        </section>

        <section className="debug-card">
          <h2 className="debug-card-title">Katalog</h2>
          <dl className="debug-kv">
            <dt>Materiály</dt>
            <dd>{stats.materialsCount}</dd>
            <dt>Poslední sync materiálů</dt>
            <dd>{formatTime(stats.lastMaterialsSync)}</dd>
            <dt>Lokace</dt>
            <dd>{stats.locationsCount}</dd>
            <dt>Poslední sync lokací</dt>
            <dd>{formatTime(stats.lastLocationsSync)}</dd>
          </dl>
          <div className="debug-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSyncCatalog}
              disabled={catalogBusy || !stats.online}
            >
              {catalogBusy ? 'Synchronizuji…' : 'Sync teď (delta)'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={handleResetCatalog}
              disabled={catalogBusy || !stats.online}
            >
              Full refresh
            </button>
          </div>
        </section>

        <section className="debug-card">
          <h2 className="debug-card-title">Fronta pohybů</h2>
          <div className="debug-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleFlush}
              disabled={queueBusy || !stats.online}
            >
              {queueBusy ? 'Odesílám…' : 'Odeslat teď'}
            </button>
          </div>
          {pending.length === 0 ? (
            <p className="debug-empty">Žádné čekající pohyby.</p>
          ) : (
            <ul className="queue-list">
              {pending.map((move) => (
                <li key={move.client_uuid} className="queue-item">
                  <div className="queue-item-head">
                    <span className={`queue-type queue-type-${move.type}`}>{move.type}</span>
                    <span className="queue-qty">{move.quantity}</span>
                  </div>
                  <div className="queue-meta">
                    <span>mat {move.material_id}</span>
                    <span>sklad {move.warehouse_id}</span>
                    <span>{formatTime(move.created_at)}</span>
                  </div>
                  {move.last_error && <div className="queue-error">{move.last_error}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {failed.length > 0 && (
          <section className="debug-card">
            <h2 className="debug-card-title">Selhalé pohyby ({failed.length})</h2>
            <ul className="queue-list">
              {failed.map((move) => (
                <li key={move.client_uuid} className="queue-item queue-item-failed">
                  <div className="queue-item-head">
                    <span className={`queue-type queue-type-${move.type}`}>{move.type}</span>
                    <span className="queue-qty">{move.quantity}</span>
                  </div>
                  <div className="queue-meta">
                    <span>mat {move.material_id}</span>
                    <span>sklad {move.warehouse_id}</span>
                    <span>{formatTime(move.created_at)}</span>
                  </div>
                  {move.last_error && <div className="queue-error">{move.last_error}</div>}
                  <div className="queue-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => handleRetryFailed(move.client_uuid)}
                    >
                      Zkusit znovu
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => handleDelete(move.client_uuid)}
                    >
                      Smazat
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="debug-card">
          <h2 className="debug-card-title">Zařízení</h2>
          <dl className="debug-kv">
            <dt>Device ID</dt>
            <dd className="debug-mono">{getDeviceId()}</dd>
          </dl>
        </section>
      </main>
    </div>
  );
}
