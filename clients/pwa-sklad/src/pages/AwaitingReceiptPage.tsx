// HolyOS PWA — Faktury čekající na příjem (Fáze 12)
// Workflow:
//   1) PWA vytáhne /api/wh/pwa/awaiting-receipt — AP faktury s order_id, bez příjemky
//   2) Skladník klikne na fakturu → vidí položky objednávky
//   3) Klik "Potvrdit příjem" → vyrobí WarehouseDocument typu receive
//      a faktura se posune ze stavu awaiting_goods_receipt na goods_received

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listAwaitingReceipt,
  confirmReceipt,
  type AwaitingInvoice,
} from '../api/awaiting-receipt';
import { ApiError } from '../api/client';

const DEFAULT_WAREHOUSE_ID = 1; // SKLAD-A-RK (per memory holyos_warehouse_ids)

function fmtAmount(n: number): string {
  return n.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('cs-CZ');
  } catch {
    return iso;
  }
}

export default function AwaitingReceiptPage() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<AwaitingInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AwaitingInvoice | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const list = await listAwaitingReceipt();
      setInvoices(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Načítání selhalo');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function onConfirm(inv: AwaitingInvoice) {
    if (!confirm(`Potvrdit příjem zboží na fakturu ${inv.invoice_number}?\n\n${inv.items.length} položek z ${inv.company}\n\nVytvoří se příjemka a faktura přejde do "Připraveno k platbě".`)) {
      return;
    }
    setConfirming(true);
    try {
      const result = await confirmReceipt(inv.id, { warehouse_id: DEFAULT_WAREHOUSE_ID });
      alert(`✓ Příjemka ${result.document_number} vytvořena.\nFaktura ${result.invoice_number} → ${result.new_invoice_status}`);
      setSelected(null);
      await reload();
    } catch (e) {
      alert('Chyba: ' + (e instanceof ApiError ? e.message : 'Nepodařilo se potvrdit'));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')} type="button">
          ← Zpět
        </button>
        <div className="topbar-title">Čekání na příjem</div>
        <button className="btn btn-ghost btn-sm" onClick={reload} type="button">
          ↻
        </button>
      </header>

      <main className="screen-body">
        {loading && <div className="empty-hint">Načítám…</div>}
        {error && <div className="error-box">{error}</div>}

        {!loading && !error && invoices.length === 0 && (
          <div className="empty-hint">
            Žádné faktury nečekají na příjem.<br />
            Vše už má příjemku nebo se ještě nezpracovala.
          </div>
        )}

        {!selected && invoices.length > 0 && (
          <ul className="awaiting-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {invoices.map((inv) => (
              <li
                key={inv.id}
                onClick={() => setSelected(inv)}
                style={{
                  background: 'var(--card-bg, #1a1a1a)',
                  border: '1px solid var(--border, #333)',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  marginBottom: '10px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <strong style={{ fontSize: '15px' }}>{inv.invoice_number}</strong>
                  <span style={{ fontSize: '14px', fontWeight: 600 }}>
                    {fmtAmount(inv.total)} {inv.currency}
                  </span>
                </div>
                <div style={{ fontSize: '13px', color: '#999', marginTop: '4px' }}>
                  {inv.company}
                </div>
                <div style={{ fontSize: '12px', color: '#777', marginTop: '6px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>OBJ: {inv.order_number || '—'}</span>
                  <span>{fmtDate(inv.date_issued)}</span>
                </div>
                <div style={{ fontSize: '12px', color: '#aaa', marginTop: '6px' }}>
                  📦 {inv.items.length} {inv.items.length === 1 ? 'položka' : 'položek'}
                </div>
              </li>
            ))}
          </ul>
        )}

        {selected && (
          <div>
            <button
              className="btn btn-ghost"
              onClick={() => setSelected(null)}
              type="button"
              style={{ marginBottom: '12px' }}
            >
              ← Zpět na seznam
            </button>

            <div style={{
              background: 'var(--card-bg, #1a1a1a)',
              border: '1px solid var(--border, #333)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '12px',
            }}>
              <h2 style={{ margin: '0 0 8px 0', fontSize: '17px' }}>{selected.invoice_number}</h2>
              <div style={{ color: '#aaa', marginBottom: '4px' }}>{selected.company}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#888' }}>
                <span>OBJ: {selected.order_number || '—'}</span>
                <span>{fmtAmount(selected.total)} {selected.currency}</span>
              </div>
              {selected.external_number && (
                <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                  Ext.: {selected.external_number}
                </div>
              )}
            </div>

            <h3 style={{ fontSize: '14px', margin: '16px 0 8px 0' }}>Položky objednávky</h3>
            {selected.items.length === 0 && (
              <div className="empty-hint" style={{ fontSize: '13px' }}>
                Objednávka nemá položky (zřejmě faktura za službu).
              </div>
            )}
            {selected.items.map((it, idx) => (
              <div
                key={it.id || idx}
                style={{
                  background: 'var(--card-bg, #1a1a1a)',
                  border: '1px solid var(--border, #333)',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  marginBottom: '6px',
                  fontSize: '13px',
                }}
              >
                <div style={{ fontWeight: 600 }}>{it.material_name || '—'}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#999', fontSize: '12px', marginTop: '4px' }}>
                  <span>{it.material_code || ''}</span>
                  <span>{fmtAmount(it.quantity)} {it.unit}</span>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() => onConfirm(selected)}
              disabled={confirming}
              className="btn btn-primary"
              style={{
                width: '100%',
                marginTop: '20px',
                padding: '14px',
                fontSize: '16px',
                background: '#10b981',
                border: 'none',
                color: 'white',
                borderRadius: '8px',
                fontWeight: 600,
              }}
            >
              {confirming ? 'Potvrzuji…' : '✓ Potvrdit příjem zboží'}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
