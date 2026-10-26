// HolyOS PWA — Příjem: rozcestník (podle objednávky / podle dodavatele / volný příjem skenem).
import { useNavigate } from 'react-router-dom';

export default function ReceivePage() {
  const navigate = useNavigate();
  const options = [
    { key: 'order', icon: '📋', label: 'Podle objednávky', hint: 'Číslo objednávky nebo sken z dodacího listu', to: '/receive/order' },
    { key: 'supplier', icon: '🏭', label: 'Podle dodavatele', hint: 'Vyber dodavatele → jeho otevřené objednávky', to: '/receive/order?by=supplier' },
    { key: 'free', icon: '▦', label: 'Volný příjem', hint: 'Naskenovat materiál bez objednávky', to: '/receive/free' },
  ];
  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')} type="button">← Zpět</button>
        <div className="topbar-title">Příjem</div>
        <span style={{ width: 48 }} />
      </header>
      <main className="screen-body">
        <h1 className="screen-title">Jak přijímáte?</h1>
        <div className="tile-grid">
          {options.map((o) => (
            <button key={o.key} type="button" className="tile tile-receive" onClick={() => navigate(o.to)}>
              <span className="tile-icon" aria-hidden="true">{o.icon}</span>
              <span className="tile-label">{o.label}</span>
              <span className="tile-hint">{o.hint}</span>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
