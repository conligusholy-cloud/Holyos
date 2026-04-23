// HolyOS PWA — Příjem materiálu na sklad.
import MoveWizard from '../components/move-wizard/MoveWizard';

export default function ReceivePage() {
  return (
    <MoveWizard
      type="receipt"
      title="Příjem"
      steps={['scan_material', 'scan_to_location', 'enter_quantity']}
    />
  );
}
