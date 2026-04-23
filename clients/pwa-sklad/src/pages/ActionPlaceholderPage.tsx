// HolyOS PWA — obecný placeholder pro akce, které dodá M3/M4.
import { useNavigate } from 'react-router-dom';

interface Props {
  title: string;
  milestone: string;
  description: string;
}

export default function ActionPlaceholderPage({ title, milestone, description }: Props) {
  const navigate = useNavigate();
  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')} type="button">
          ← Zpět
        </button>
        <div className="topbar-title">{title}</div>
        <span />
      </header>

      <main className="screen-body screen-body-center">
        <div className="placeholder-card">
          <div className="placeholder-milestone">Dodá {milestone}</div>
          <h2 className="placeholder-title">{title}</h2>
          <p className="placeholder-desc">{description}</p>
        </div>
      </main>
    </div>
  );
}
