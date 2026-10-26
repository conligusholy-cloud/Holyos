// HolyOS PWA — Volný příjem materiálu na sklad (sken materiálu → lokace → množství).
import MoveWizard from '../components/move-wizard/MoveWizard';

export default function ReceiveFreePage() {
  return (
    <MoveWizard
      type="receipt"
      title="Příjem"
      steps={['scan_material', 'scan_to_location', 'enter_quantity']}
    />
  );
}
