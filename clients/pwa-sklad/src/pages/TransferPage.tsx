// HolyOS PWA — Přesun materiálu mezi lokacemi.
import MoveWizard from '../components/move-wizard/MoveWizard';

export default function TransferPage() {
  return (
    <MoveWizard
      type="transfer"
      title="Přesun"
      steps={['scan_material', 'scan_from_location', 'scan_to_location', 'enter_quantity']}
    />
  );
}
