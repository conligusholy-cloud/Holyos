// HolyOS PWA — dolní pruh se stavem připojení a fronty.
import { useNavigate } from 'react-router-dom';
import { useSync } from '../sync/SyncContext';

export default function SyncBottomBar() {
  const navigate = useNavigate();
  const { stats, queueBusy } = useSync();

  const statusDot = stats.online ? 'dot-online' : 'dot-offline';
  const statusLabel = stats.online ? 'Online' : 'Offline';

  const pendingLabel = stats.pendingCount > 0 ? ` · ${stats.pendingCount} ve frontě` : '';
  const failedLabel = stats.failedCount > 0 ? ` · ${stats.failedCount} selhalo` : '';

  return (
    <button
      type="button"
      className={`bottombar bottombar-interactive ${queueBusy ? 'is-busy' : ''}`}
      onClick={() => navigate('/debug')}
    >
      <span className={`bottombar-status ${statusDot}`} aria-hidden="true">●</span>
      <span className="bottombar-main">
        {statusLabel}
        {pendingLabel}
        {failedLabel}
      </span>
      <span className="bottombar-cta">Detail ›</span>
    </button>
  );
}
