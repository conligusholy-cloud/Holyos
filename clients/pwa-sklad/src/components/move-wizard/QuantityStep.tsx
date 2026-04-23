// HolyOS PWA — quantity step (numpad).

import { useState } from 'react';
import type { CachedMaterial } from '../../db/schema';

interface Props {
  material: CachedMaterial;
  initialValue?: number;
  onSubmit: (value: number) => void;
  onBack: () => void;
  onCancel: () => void;
}

const KEYS: Array<{ label: string; value: string } | { label: string; action: 'dot' | 'back' }> = [
  { label: '1', value: '1' },
  { label: '2', value: '2' },
  { label: '3', value: '3' },
  { label: '4', value: '4' },
  { label: '5', value: '5' },
  { label: '6', value: '6' },
  { label: '7', value: '7' },
  { label: '8', value: '8' },
  { label: '9', value: '9' },
  { label: ',', action: 'dot' },
  { label: '0', value: '0' },
  { label: '⌫', action: 'back' },
];

export default function QuantityStep({ material, initialValue, onSubmit, onBack, onCancel }: Props) {
  const [raw, setRaw] = useState<string>(
    initialValue != null && initialValue > 0 ? String(initialValue) : ''
  );
  const [error, setError] = useState<string | null>(null);

  function press(char: string) {
    setError(null);
    setRaw((current) => {
      if (char === '.' || char === ',') {
        if (current.includes('.')) return current;
        return current.length === 0 ? '0.' : current + '.';
      }
      // rozumný limit délky (ať se to nikdy nerozsype na screen)
      if (current.length >= 9) return current;
      // neakceptuj leading 0 pokud user ťukne další číslo (kromě 0.)
      if (current === '0' && char !== '.') return char;
      return current + char;
    });
  }

  function backspace() {
    setRaw((current) => current.slice(0, -1));
  }

  function handleSubmit() {
    const normalized = raw.replace(',', '.');
    const value = Number(normalized);
    if (!Number.isFinite(value) || value <= 0) {
      setError('Zadejte kladné množství');
      return;
    }
    onSubmit(value);
  }

  const display = raw.length === 0 ? '0' : raw.replace('.', ',');

  return (
    <div className="wizard-step">
      <header className="wizard-step-head">
        <div className="wizard-kicker">Množství</div>
        <h2 className="wizard-step-title">{material.name}</h2>
        <p className="wizard-step-sub">
          {material.code}
          {material.unit ? ` · ${material.unit}` : ''}
        </p>
      </header>

      <div className="numpad-display" aria-live="polite">
        <span className="numpad-value">{display}</span>
        {material.unit && <span className="numpad-unit">{material.unit}</span>}
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <div className="numpad-grid">
        {KEYS.map((key) => {
          if ('action' in key) {
            if (key.action === 'back') {
              return (
                <button
                  key="back"
                  type="button"
                  className="numpad-key numpad-key-aux"
                  onClick={backspace}
                >
                  {key.label}
                </button>
              );
            }
            return (
              <button
                key="dot"
                type="button"
                className="numpad-key numpad-key-aux"
                onClick={() => press('.')}
              >
                {key.label}
              </button>
            );
          }
          return (
            <button
              key={key.value}
              type="button"
              className="numpad-key"
              onClick={() => press(key.value)}
            >
              {key.label}
            </button>
          );
        })}
      </div>

      <div className="wizard-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={handleSubmit}>
          Pokračovat
        </button>
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          ← Zpět
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Zrušit
        </button>
      </div>
    </div>
  );
}
