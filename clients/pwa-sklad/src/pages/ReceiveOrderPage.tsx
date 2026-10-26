// HolyOS PWA — Příjem podle nákupní objednávky.
// Kroky: 1) najít objednávku (číslo / sken / dodavatel) → 2) přijaté množství po položkách
//        → 3) naskenovat cílovou lokaci → 4) potvrdit → příjemka + naskladnění + stav objednávky.

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { getOrder, listSuppliers, receiveOrder, searchOrders, type PoDetail, type PoSummary, type PoSupplier, type ReceiveResult } from '../api/receive-order';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import ScanStep from '../components/move-wizard/ScanStep';
import type { CachedLocation } from '../db/schema';

type Step = 'search' | 'items' | 'location' | 'confirm' | 'done';

const fmtDate = (iso: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString('cs-CZ'); } catch { return iso; } };
const fmtQty = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString('cs-CZ');
const newUuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'r-' + Date.now() + '-' + Math.random().toString(36).slice(2));

const card: React.CSSProperties = { background: 'var(--card-bg, #1a1a1a)', border: '1px solid var(--border, #333)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 };

export default function ReceiveOrderPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'order' | 'supplier'>(params.get('by') === 'supplier' ? 'supplier' : 'order');
  const [step, setStep] = useState<Step>('search');
  const [q, setQ] = useState('');
  const [orders, setOrders] = useState<PoSummary[]>([]);
  const [suppliers, setSuppliers] = useState<PoSupplier[]>([]);
  const [supplier, setSupplier] = useState<PoSupplier | null>(null);
  const [order, setOrder] = useState<PoDetail | null>(null);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [location, setLocation] = useState<CachedLocation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReceiveResult | null>(null);
  const [uuid] = useState(newUuid);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setLoading(true); setError(null);
    try { return await fn(); }
    catch (e) { setError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : 'Chyba')); return undefined; }
    finally { setLoading(false); }
  }

  async function doSearch(text: string, sup?: PoSupplier | null) {
    if (mode === 'supplier' && !sup) {
      const s = await run(() => listSuppliers(text)); if (s) setSuppliers(s);
      return;
    }
    const list = await run(() => searchOrders(text, sup ? sup.id : undefined));
    if (!list) return;
    setOrders(list);
    // Přesná shoda čísla (sken z dodacího listu) → rovnou otevřít
    const exact = list.find((o) => o.order_number.toLowerCase() === text.trim().toLowerCase());
    if (exact && mode === 'order') openOrder(exact.id);
  }

  useEffect(() => { doSearch('', null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mode]);

  async function openOrder(id: number) {
    const o = await run(() => getOrder(id));
    if (!o) return;
    setOrder(o);
    const init: Record<number, string> = {};
    o.items.forEach((it) => { init[it.id] = it.remaining > 0 ? String(it.remaining) : ''; });
    setQty(init);
    setStep('items');
  }

  // Čtečka: na kroku hledání bere číslo objednávky, na kroku položek materiál → zvýrazní řádek
  const [flash, setFlash] = useState<number | null>(null);
  useBarcodeScanner({
    enabled: (step === 'search' && mode === 'order') || step === 'items',
    onScan: (code: string) => {
      if (step === 'search') { setQ(code); doSearch(code, null); return; }
      if (step === 'items' && order) {
        const it = order.items.find((x) => (x.barcode && x.barcode === code) || (x.material_code && x.material_code.toLowerCase() === code.toLowerCase()));
        if (it) { setFlash(it.id); setTimeout(() => setFlash(null), 1500); document.getElementById('poi-' + it.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        else setError('Naskenovaný kód ' + code + ' v této objednávce není.');
      }
    },
  });

  const lines = order ? order.items.map((it) => ({ it, q: Number(String(qty[it.id] || '').replace(',', '.')) })).filter((l) => l.q > 0) : [];

  async function submit() {
    if (!order || !location) return;
    const r = await run(() => receiveOrder(order.id, { location_id: location.id, lines: lines.map((l) => ({ order_item_id: l.it.id, quantity: l.q })), client_uuid: uuid }));
    if (r) { setResult(r); setStep('done'); }
  }

  if (step === 'location') {
    return (
      <div className="screen">
        <header className="topbar">
          <button className="btn btn-ghost btn-sm" onClick={() => setStep('items')} type="button">← Zpět</button>
          <div className="topbar-title">Příjem {order?.order_number}</div>
          <span className="topbar-step">3/4</span>
        </header>
        <main className="screen-body">
          <ScanStep target="location" title="Naskenujte cílovou lokaci" subtitle="Kam zboží naskladňujete" onBack={() => setStep('items')} onCancel={() => navigate('/receive')}
            onResolved={(loc) => { setLocation(loc); setStep('confirm'); }} />
        </main>
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => {
          if (step === 'items') { setStep('search'); setOrder(null); return; }
          if (step === 'confirm') { setStep('location'); return; }
          if (step === 'search' && supplier) { setSupplier(null); setOrders([]); doSearch('', null); return; }
          navigate('/receive');
        }}>← Zpět</button>
        <div className="topbar-title">{step === 'search' ? 'Příjem podle objednávky' : 'Příjem ' + (order?.order_number || '')}</div>
        <span className="topbar-step">{step === 'search' ? '1/4' : step === 'items' ? '2/4' : step === 'confirm' ? '4/4' : ''}</span>
      </header>

      <main className="screen-body">
        {error && <div className="error-box" style={{ marginBottom: 10 }}>{error}</div>}

        {step === 'search' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button type="button" className={'btn ' + (mode === 'order' ? 'btn-primary' : 'btn-ghost')} style={{ flex: 1 }} onClick={() => { setMode('order'); setSupplier(null); setQ(''); }}>📋 Objednávka</button>
              <button type="button" className={'btn ' + (mode === 'supplier' ? 'btn-primary' : 'btn-ghost')} style={{ flex: 1 }} onClick={() => { setMode('supplier'); setSupplier(null); setQ(''); }}>🏭 Dodavatel</button>
            </div>
            {supplier && <div style={{ ...card, borderColor: 'var(--accent, #6c8cff)' }}>🏭 <b>{supplier.name}</b> — otevřené objednávky</div>}
            <form onSubmit={(e: FormEvent) => { e.preventDefault(); doSearch(q, supplier); }} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input className="field-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={mode === 'order' || supplier ? 'Číslo objednávky (PO-2026-…) nebo sken' : 'Název dodavatele'} autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ flex: 1 }} />
              <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? '…' : 'Hledat'}</button>
            </form>

            {mode === 'supplier' && !supplier && (
              suppliers.length === 0 && !loading ? <div className="empty-hint">Od žádného dodavatele nečekáme zboží.</div> :
              suppliers.map((s) => (
                <div key={s.id} style={{ ...card, cursor: 'pointer' }} onClick={() => { setSupplier(s); setQ(''); doSearch('', s); }}>
                  <div style={{ fontWeight: 700 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>{s.orders} {s.orders === 1 ? 'objednávka' : 'objednávek'} · {s.items_open} položek čeká na příjem</div>
                </div>
              ))
            )}

            {(mode === 'order' || supplier) && (
              orders.length === 0 && !loading ? <div className="empty-hint">Žádná otevřená objednávka{q ? ' pro „' + q + '“' : ''}.</div> :
              orders.map((o) => (
                <div key={o.id} style={{ ...card, cursor: 'pointer' }} onClick={() => openOrder(o.id)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <b style={{ fontSize: 15 }}>{o.order_number}</b>
                    <span style={{ fontSize: 12, color: '#aaa' }}>dodat {fmtDate(o.expected_delivery)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#bbb', marginTop: 4 }}>{o.company?.name || '—'}</div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>📦 {o.items_open} z {o.items_total} položek čeká{o.status === 'partial' ? ' · částečně přijato' : ''}{o.supplier_confirm_status === 'confirmed' ? ' · ✅ potvrzeno dodavatelem' : ''}</div>
                </div>
              ))
            )}
          </>
        )}

        {step === 'items' && order && (
          <>
            <div style={card}>
              <div style={{ fontWeight: 700 }}>{order.company?.name}</div>
              <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>Zadejte skutečně přijaté množství. Naskenováním materiálu se položka zvýrazní.</div>
            </div>
            {order.items.map((it) => (
              <div key={it.id} id={'poi-' + it.id} style={{ ...card, opacity: it.remaining > 0 ? 1 : 0.5, borderColor: flash === it.id ? '#10b981' : undefined, boxShadow: flash === it.id ? '0 0 0 2px #10b981' : undefined }}>
                <div style={{ fontWeight: 600 }}>{it.name}</div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>{it.material_code || 'bez skladové karty'} · objednáno {fmtQty(it.quantity)} {it.unit} · přijato {fmtQty(it.delivered_quantity)}{it.expected_delivery ? ' · termín ' + fmtDate(it.confirmed_delivery || it.expected_delivery) : ''}</div>
                {it.material_id ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                    <span style={{ fontSize: 13, color: '#bbb', flex: 1 }}>Přijato nyní (zbývá {fmtQty(it.remaining)} {it.unit})</span>
                    <input className="field-input" inputMode="decimal" value={qty[it.id] ?? ''} onChange={(e) => setQty({ ...qty, [it.id]: e.target.value })} style={{ width: 96, textAlign: 'right' }} />
                    <span style={{ width: 28 }}>{it.unit}</span>
                  </div>
                ) : <div style={{ fontSize: 12, color: '#f59e0b', marginTop: 6 }}>Položka nemá skladovou kartu — na sklad ji nelze přijmout.</div>}
              </div>
            ))}
            <button type="button" className="btn btn-primary" style={{ width: '100%', padding: 14, fontSize: 16, marginTop: 8 }} disabled={!lines.length} onClick={() => setStep('location')}>
              Dál — cílová lokace ({lines.length} {lines.length === 1 ? 'položka' : 'položek'}) →
            </button>
          </>
        )}

        {step === 'confirm' && order && location && (
          <>
            <div style={card}>
              <div style={{ fontSize: 13, color: '#aaa' }}>Objednávka</div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{order.order_number} · {order.company?.name}</div>
              <div style={{ fontSize: 13, color: '#aaa', marginTop: 8 }}>Lokace</div>
              <div style={{ fontWeight: 700 }}>{location.label}</div>
            </div>
            {lines.map((l) => (
              <div key={l.it.id} style={{ ...card, display: 'flex', justifyContent: 'space-between' }}>
                <span>{l.it.name}</span><b>{fmtQty(l.q)} {l.it.unit}</b>
              </div>
            ))}
            <button type="button" className="btn btn-primary" style={{ width: '100%', padding: 14, fontSize: 16, marginTop: 8, background: '#10b981', border: 'none' }} disabled={loading} onClick={submit}>
              {loading ? 'Přijímám…' : '✓ Potvrdit příjem'}
            </button>
          </>
        )}

        {step === 'done' && result && (
          <div style={{ textAlign: 'center', paddingTop: 20 }}>
            <div style={{ fontSize: 48 }}>✅</div>
            <h2>Přijato</h2>
            <div style={{ color: '#bbb' }}>Příjemka <b>{result.document_number}</b> · lokace {result.location}</div>
            <div style={{ color: '#bbb', marginTop: 6 }}>{result.order_status === 'delivered' ? 'Objednávka je kompletně přijatá.' : 'Objednávka je přijatá částečně — zbytek přijmete později.'}</div>
            {result.invoices_linked > 0 && <div style={{ color: '#10b981', marginTop: 6 }}>Faktura napojena na příjemku.</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
              <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate('/')}>Domů</button>
              <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => { setStep('search'); setOrder(null); setResult(null); setLocation(null); doSearch('', supplier); }}>Další příjem</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
