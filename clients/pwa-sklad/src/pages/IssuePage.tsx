// HolyOS PWA — Výdej materiálu ze skladu.
import MoveWizard from '../components/move-wizard/MoveWizard';

export default function IssuePage() {
  return (
    <MoveWizard
      type="issue"
      title="Výdej"
      steps={['scan_material', 'scan_from_location', 'enter_quantity']}
    />
  );
}
