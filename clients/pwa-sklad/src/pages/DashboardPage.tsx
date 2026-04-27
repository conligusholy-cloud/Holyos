// HolyOS PWA — hlavní rozcestník akcí na čtečce.
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import SyncBottomBar from '../components/SyncBottomBar';

interface Action {
  key: string;
  label: string;
  hint: string;
  to: string;
  accent: 'receive' | 'issue' | 'transfer' | 'inventory' | 'picking' | 'stock-check' | 'info';
  icon: string;
}

const ACTIONS: Action[] = [
  { key: 'receive', label: 'Příjem', hint: 'Naskladnit materiál', to: '/receive', accent: 'receive', icon: '⬇' },
  { key: 'issue', label: 'Výdej', hint: 'Vyskladnit na zakázku', to: '/issue', accent: 'issue', icon: '⬆' },
  { key: 'transfer', label: 'Přesun', hint: 'Mezi lokacemi', to: '/transfer', accent: 'transfer', icon: '⇄' },
  { key: 'inventory', label: 'Inventura', hint: 'Počítání + odchylky', to: '/inventory', accent: 'inventory', icon: '✓' },
  { key: 'picking', label: 'Picking', hint: 'Dávky na expedici', to: '/picking', accent: 'picking', icon: '☰' },
  { key: 'stock-check', label: 'Kontrola stavu', hint: 'Sken → stav po lokacích', to: '/stock-check', accent: 'stock-check', icon: '⚗' },
  { key: 'info', label: 'Info o zboží', hint: 'Sken → plný detail', to: '/info', accent: 'info', icon: '👁' },
];

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const displayName = user?.person
    ? `${user.person.firstName} ${user.person.lastName}`.trim()
    : (user?.displayName ?? user?.username ?? '–');

  return (
    <div className="screen">
      <header className="topbar">
        <div className="topbar-user">
          <div className="topbar-user-name">{displayName}</div>
          <div className="topbar-user-role">{user?.role ?? ''}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={logout} type="button">
          Odhlásit
        </button>
      </header>

      <main className="screen-body">
        <h1 className="screen-title">Vyberte akci</h1>
        <div className="tile-grid">
          {ACTIONS.map((action) => (
            <button
              key={action.key}
              type="button"
              className={`tile tile-${action.accent}`}
              onClick={() => navigate(action.to)}
            >
              <span className="tile-icon" aria-hidden="true">{action.icon}</span>
              <span className="tile-label">{action.label}</span>
              <span className="tile-hint">{action.hint}</span>
            </button>
          ))}
        </div>
      </main>

      <SyncBottomBar />
    </div>
  );
}
