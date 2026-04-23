// HolyOS PWA — confirm / submit step.

import type { MoveType, WizardData } from './types';

interface Props {
  type: MoveType;
  data: WizardData;
  submitting: boolean;
  onSubmit: () => void;
  onBack: () => void;
  onCancel: () => void;
}

const TYPE_LABEL: Record<MoveType, string> = {
  receipt: 'Příjem',
  issue: 'Výdej',
  transfer: 'Přesun',
};

export default function ConfirmStep({ type, data, submitting, onSubmit, onBack, onCancel }: Props) {
  const { material, fromLocation, toLocation, quantity } = data;
  return (
    <div className="wizard-step">
      <header className="wizard-step-head">
        <div className="wizard-kicker">Potvrzení</div>
        <h2 className="wizard-step-title">{TYPE_LABEL[type]}</h2>
      </header>

      <dl className="wizard-summary">
        {material && (
          <>
            <dt>Materiál</dt>
            <dd>
              <div className="summary-main">{material.name}</div>
              <div className="summary-sub">{material.code}</div>
            </dd>
          </>
        )}

        {quantity != null && (
          <>
            <dt>Množství</dt>
            <dd className="summary-qty">
              {quantity.toLocaleString('cs-CZ', { maximumFractionDigits: 3 })}
              {material?.unit ? ` ${material.unit}` : ''}
            </dd>
          </>
        )}

        {fromLocation && (
          <>
            <dt>Z lokace</dt>
            <dd>
              <div className="summary-main">{fromLocation.label}</div>
              <div className="summary-sub">sklad #{fromLocation.warehouse_id}</div>
            </dd>
          </>
        )}

        {toLocation && (
          <>
            <dt>Na lokaci</dt>
            <dd>
              <div className="summary-main">{toLocation.label}</div>
              <div className="summary-sub">sklad #{toLocation.warehouse_id}</div>
            </dd>
          </>
        )}
      </dl>

      <div className="wizard-actions">
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={onSubmit}
          disabled={submitting}
        >
          {submitting ? 'Odesílám…' : 'Potvrdit pohyb'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onBack} disabled={submitting}>
          ← Zpět
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={submitting}>
          Zrušit
        </button>
      </div>
    </div>
  );
}
