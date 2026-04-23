// HolyOS PWA — orchestrátor stepů pro pohyb skladu.
//
// Wizard je data-driven: zadavatel (stránka akce) předá seznam kroků a typ
// pohybu. Wizard sám přidá na konec `confirm` a po submitu zobrazí SuccessStep.
//
// Flow pro backend:
//   receipt   — { type: 'receipt', material_id, warehouse_id, quantity, to_location_id }
//   issue     — { type: 'issue', material_id, warehouse_id, quantity, from_location_id }
//   transfer  — { type: 'transfer', material_id, warehouse_id, quantity,
//                 from_location_id, to_location_id }
//
// warehouse_id se bere z naskenované lokace (from má přednost; receipt → z to).

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ScanStep from './ScanStep';
import QuantityStep from './QuantityStep';
import ConfirmStep from './ConfirmStep';
import SuccessStep from './SuccessStep';
import type { MoveType, StepId, WizardData } from './types';
import type { CachedLocation, CachedMaterial } from '../../db/schema';
import { enqueueMove } from '../../db/queueRepo';
import { useSync } from '../../sync/SyncContext';

interface Props {
  type: MoveType;
  title: string;
  steps: StepId[]; // bez 'confirm' — ten se přidává automaticky
}

export default function MoveWizard({ type, title, steps }: Props) {
  const navigate = useNavigate();
  const { stats, flushQueue, refreshStats } = useSync();

  const allSteps = useMemo<StepId[]>(() => [...steps, 'confirm'], [steps]);

  const [stepIdx, setStepIdx] = useState(0);
  const [data, setData] = useState<WizardData>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const currentStep = allSteps[stepIdx];

  function advance() {
    setStepIdx((i) => Math.min(i + 1, allSteps.length - 1));
  }

  function back() {
    if (stepIdx === 0) {
      navigate('/');
      return;
    }
    setStepIdx((i) => i - 1);
  }

  function cancel() {
    navigate('/');
  }

  function handleMaterial(material: CachedMaterial) {
    setData((d) => ({ ...d, material }));
    advance();
  }

  function handleFromLocation(location: CachedLocation) {
    setData((d) => ({ ...d, fromLocation: location }));
    advance();
  }

  function handleToLocation(location: CachedLocation) {
    setData((d) => ({ ...d, toLocation: location }));
    advance();
  }

  function handleQuantity(value: number) {
    setData((d) => ({ ...d, quantity: value }));
    advance();
  }

  async function handleSubmit() {
    setSubmitError(null);

    const { material, fromLocation, toLocation, quantity } = data;
    if (!material) {
      setSubmitError('Chybí materiál');
      return;
    }
    if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) {
      setSubmitError('Chybí množství');
      return;
    }

    // Warehouse z first relevant lokace.
    const warehouseId = fromLocation?.warehouse_id ?? toLocation?.warehouse_id;
    if (warehouseId == null) {
      setSubmitError('Chybí lokace — není jasné, o který sklad jde');
      return;
    }

    const payload = {
      type,
      material_id: material.id,
      warehouse_id: warehouseId,
      quantity,
      from_location_id: fromLocation?.id ?? null,
      to_location_id: toLocation?.id ?? null,
    };

    setSubmitting(true);
    try {
      await enqueueMove(payload);
      await refreshStats();
      // Pokud jsme online, zkusíme rovnou odeslat. Offline zůstane pending.
      if (stats.online) {
        await flushQueue();
      }
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Nepodařilo se zapsat do fronty');
    } finally {
      setSubmitting(false);
    }
  }

  function handleNew() {
    setData({});
    setStepIdx(0);
    setDone(false);
    setSubmitError(null);
  }

  if (done) {
    return (
      <div className="screen">
        <header className="topbar">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            ← Dashboard
          </button>
          <div className="topbar-title">{title}</div>
          <span />
        </header>
        <main className="screen-body">
          <SuccessStep
            type={type}
            data={data}
            online={stats.online}
            onNew={handleNew}
            onHome={() => navigate('/')}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={back}>
          ← Zpět
        </button>
        <div className="topbar-title">{title}</div>
        <span className="wizard-progress">
          {stepIdx + 1}/{allSteps.length}
        </span>
      </header>

      <main className="screen-body">
        {currentStep === 'scan_material' && (
          <ScanStep
            target="material"
            title="Naskenujte materiál"
            subtitle="Přiložte čtečku k QR kódu materiálu."
            onResolved={handleMaterial}
            onBack={back}
            onCancel={cancel}
          />
        )}
        {currentStep === 'scan_from_location' && (
          <ScanStep
            target="location"
            title="Naskenujte zdrojovou lokaci"
            subtitle="Odkud materiál vydáváte/přesouváte."
            onResolved={handleFromLocation}
            onBack={back}
            onCancel={cancel}
          />
        )}
        {currentStep === 'scan_to_location' && (
          <ScanStep
            target="location"
            title="Naskenujte cílovou lokaci"
            subtitle="Kam materiál přijímáte/přesouváte."
            onResolved={handleToLocation}
            onBack={back}
            onCancel={cancel}
          />
        )}
        {currentStep === 'enter_quantity' && data.material && (
          <QuantityStep
            material={data.material}
            initialValue={data.quantity}
            onSubmit={handleQuantity}
            onBack={back}
            onCancel={cancel}
          />
        )}
        {currentStep === 'confirm' && (
          <>
            <ConfirmStep
              type={type}
              data={data}
              submitting={submitting}
              onSubmit={handleSubmit}
              onBack={back}
              onCancel={cancel}
            />
            {submitError && (
              <div className="alert alert-error" role="alert" style={{ marginTop: '16px' }}>
                {submitError}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
