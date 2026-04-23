// HolyOS PWA — úspěch po zapsání pohybu do fronty.

import type { MoveType, WizardData } from './types';

interface Props {
  type: MoveType;
  data: WizardData;
  online: boolean;
  onNew: () => void;
  onHome: () => void;
}

const TYPE_LABEL: Record<MoveType, string> = {
  receipt: 'Příjem',
  issue: 'Výdej',
  transfer: 'Přesun',
};

export default function SuccessStep({ type, data, online, onNew, onHome }: Props) {
  const { material, quantity } = data;
  return (
    <div className="wizard-step wizard-step-success">
      <div className="wizard-success-icon" aria-hidden="true">✓</div>
      <h2 className="wizard-step-title">{TYPE_LABEL[type]} zaznamenán</h2>
      {material && quantity != null && (
        <p className="wizard-success-line">
          {material.name} · {quantity.toLocaleString('cs-CZ', { maximumFractionDigits: 3 })}
          {material.unit ? ` ${material.unit}` : ''}
        </p>
      )}
      <p className="wizard-hint">
        {online
          ? 'Pohyb byl odeslán na server.'
          : 'Zařízení je offline — pohyb čeká ve frontě, odešle se automaticky po návratu online.'}
      </p>
      <div className="wizard-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={onNew}>
          Další pohyb
        </button>
        <button type="button" className="btn" onClick={onHome}>
          Dashboard
        </button>
      </div>
    </div>
  );
}
