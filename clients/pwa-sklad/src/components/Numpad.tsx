// HolyOS PWA — sdílený numpad pro zadání množství.
//
// Bezstátní: hodnotu (raw string) drží rodič. Komponenta jen vyvolává onChange.
// Akceptuje jen číslice + jednu desetinnou čárku; maximální délka 9 znaků
// (vyhýbáme se přetečení na malém displeji).

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

interface Props {
  value: string;
  onChange: (next: string) => void;
  unit?: string | null;
}

export default function Numpad({ value, onChange, unit }: Props) {
  function press(char: string) {
    if (value.length >= 9) return;
    if (char === '.' || char === ',') {
      if (value.includes('.')) return;
      onChange(value.length === 0 ? '0.' : value + '.');
      return;
    }
    if (value === '0' && char !== '.') {
      onChange(char);
      return;
    }
    onChange(value + char);
  }

  function backspace() {
    onChange(value.slice(0, -1));
  }

  function clearAll() {
    onChange('');
  }

  const display = value.length === 0 ? '0' : value.replace('.', ',');

  return (
    <>
      <div className="numpad-display" aria-live="polite">
        <span className="numpad-value">{display}</span>
        {unit && <span className="numpad-unit">{unit}</span>}
      </div>
      <div className="numpad-grid">
        {KEYS.map((k) => (
          <button key={k} type="button" className="numpad-key" onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <button type="button" className="numpad-key numpad-key-aux" onClick={() => press('.')}>
          ,
        </button>
        <button type="button" className="numpad-key" onClick={() => press('0')}>
          0
        </button>
        <button type="button" className="numpad-key numpad-key-aux" onClick={backspace}>
          ⌫
        </button>
        <button
          type="button"
          className="numpad-key numpad-key-wide"
          onClick={clearAll}
        >
          Smazat
        </button>
      </div>
    </>
  );
}

export function parseNumpad(raw: string): number | null {
  if (raw.length === 0) return null;
  const normalized = raw.replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}
