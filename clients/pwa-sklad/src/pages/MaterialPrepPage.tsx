// HolyOS PWA — Příprava materiálu pro výrobu
// Skladník vidí z plánu výroby, CO má KAM a NA KDY připravit (materiál na vstupní sklad
// pracoviště + přesun rozpracovaného výrobku na další pracoviště). Úkol odškrtne jako
// „Připraveno". Když je připraveno dřív, může zkusit „Posunout výrobu dřív" — server
// posune operaci, jen pokud má pracoviště i montér (přiřazení lidé) volno.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listPrepTasks, markPrepared, unmarkPrepared, pullEarlier, type PrepTask } from '../api/material-prep';
import { ApiError } from '../api/client';

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }); } catch { return '—'; }
}
function dayKey(iso: string): string {
  const d = new Date(iso); d.setHours(0, 0, 0, 0); return d.toISOString();
}
function dayLabel(iso: string): string {
  const d = new Date(iso); const t = new Date(); t.setHours(0, 0, 0, 0);
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const diff = Math.round((dd.getTime() - t.getTime()) / 86400000);
  const date = d.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'numeric' });
  if (diff === 0) return 'Dnes · ' + date;
  if (diff === 1) return 'Zítra · ' + date;
  if (diff < 0) return 'Po termínu · ' + date;
  return date;
}
function placeLabel(p: PrepTask['from'] | PrepTask['to']): string {
  if (!p) return '—';
  const parts: string[] = [];
  if (p.workstation) parts.push(p.workstation.name);
  if (p.warehouse) parts.push(p.warehouse.name);
  if (p.location) parts.push(p.location.label);
  return parts.join(' · ') || '—';
}
function statusBadge(t: PrepTask): { text: string; color: string } {
  if (t.prepared) return { text: '✓ připraveno', color: '#22c55e' };
  const overdue = new Date(t.due).getTime() < Date.now();
  if (t.status === 'no_stock') return { text: 'není skladem', color: '#ef4444' };
  if (t.status === 'partial') return { text: 'částečně skladem', color: '#f59e0b' };
  if (t.status === 'no_target') return { text: 'chybí sklad pracoviště', color: '#f59e0b' };
  return overdue ? { text: 'po termínu — připravit', color: '#ef4444' } : { text: 'připravit', color: '#60a5fa' };
}

export default function MaterialPrepPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<PrepTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function reload() {
    setLoading(true); setError(null);
    try { const r = await listPrepTasks(7); setTasks(r.tasks || []); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Načítání plánu selhalo'); }
    finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  function showToast(msg: string) { setToast(msg); window.setTimeout(() => setToast(null), 4500); }

  async function onToggle(t: PrepTask) {
    setBusyKey(t.key);
    try {
      if (t.prepared) await unmarkPrepared(t.key); else await markPrepared(t.key, t.qty);
      setTasks(prev => prev.map(x => x.key === t.key ? { ...x, prepared: !t.prepared, status: !t.prepared ? 'prepared' : 'ok' } : x));
    } catch (e) { showToast(e instanceof ApiError ? e.message : 'Uložení selhalo'); }
    finally { setBusyKey(null); }
  }

  async function onPullEarlier(t: PrepTask) {
    if (!confirm(`Posunout výrobu dřív?\n\n${t.operation.step}. ${t.operation.name} · ${t.batch.product.code} (dávka ${t.batch.batch_number})\n\nPosune se jen, když má pracoviště i montér volno.`)) return;
    setBusyKey(t.key + ':pull');
    try {
      const r = await pullEarlier(t.operation.batch_operation_id);
      if (r.moved && r.to_start) {
        showToast(`✅ Výroba posunuta: ${new Date(r.to_start).toLocaleString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}`);
        await reload();
      } else {
        showToast('⏸ ' + (r.reason || 'Dřívější termín není k dispozici.'));
      }
    } catch (e) { showToast(e instanceof ApiError ? e.message : 'Posun selhal'); }
    finally { setBusyKey(null); }
  }

  const visible = useMemo(() => hideDone ? tasks.filter(t => !t.prepared) : tasks, [tasks, hideDone]);
  const groups = useMemo(() => {
    const m = new Map<string, PrepTask[]>();
    for (const t of visible) { const k = dayKey(t.due); if (!m.has(k)) m.set(k, []); m.get(k)!.push(t); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);
  const openCount = tasks.filter(t => !t.prepared).length;

  return (
    <div className="screen">
      <header className="topbar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')} type="button">‹ Zpět</button>
        <div className="topbar-title">Příprava materiálu</div>
        <button className="btn btn-ghost btn-sm" onClick={reload} type="button">↻</button>
      </header>

      <main className="screen-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 10px', fontSize: 13, color: '#aaa' }}>
          <span>{openCount} k přípravě · {tasks.length - openCount} hotovo</span>
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} /> skrýt hotové
          </label>
        </div>

        {loading && <div className="empty-hint">Načítám plán…</div>}
        {error && <div className="error-box">{error}</div>}
        {!loading && !error && visible.length === 0 && (
          <div className="empty-hint">Nic k přípravě na nejbližších 7 dní. 👍</div>
        )}

        {groups.map(([k, list]) => (
          <section key={k} style={{ marginBottom: 18 }}>
            <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em', color: '#9aa0ad', margin: '8px 0 8px' }}>{dayLabel(list[0].due)}</h3>
            {list.map(t => {
              const b = statusBadge(t);
              const isBusy = busyKey === t.key || busyKey === t.key + ':pull';
              return (
                <div key={t.key} style={{
                  background: t.prepared ? 'rgba(34,197,94,0.07)' : 'var(--card2, #1b1f2a)',
                  border: '1px solid ' + (t.prepared ? 'rgba(34,197,94,0.45)' : 'rgba(255,255,255,0.08)'),
                  borderRadius: 14, padding: '12px 14px', marginBottom: 10,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>do {fmtTime(t.due)} <span style={{ fontSize: 12, fontWeight: 500, color: '#888' }}>· výroba v {fmtTime(t.start_at)}</span></div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: b.color, border: `1px solid ${b.color}55`, borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' }}>{b.text}</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: '#9aa0ad' }}>
                    {t.kind === 'material' ? '📦 materiál' : '🔁 přesun rozpracovaného výrobku'}
                    {t.kind === 'wip' && t.operation.prev_step ? ` · po ${t.operation.prev_step}. ${t.operation.prev_name}` : ''}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 16, fontWeight: 700 }}>{t.item.code} <span style={{ fontWeight: 500, color: '#ddd' }}>{t.item.name}</span></div>
                  <div style={{ fontSize: 15, marginTop: 2 }}><b>{t.qty}</b> {t.unit}{t.on_site ? <span style={{ color: '#888', fontSize: 12 }}> · na místě už {t.on_site}</span> : null}</div>
                  <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5 }}>
                    <div><span style={{ color: '#888' }}>Odkud:</span> {placeLabel(t.from)}{t.from && t.from.available != null ? <span style={{ color: '#888' }}> (k dispozici {t.from.available})</span> : null}</div>
                    <div><span style={{ color: '#888' }}>→ Kam:</span> <b>{placeLabel(t.to)}</b></div>
                    <div><span style={{ color: '#888' }}>Pro:</span> {t.operation.step}. {t.operation.name} · {t.batch.product.code} {t.batch.product.name} · dávka {t.batch.batch_number}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button type="button" disabled={isBusy} onClick={() => onToggle(t)} className="btn"
                      style={{ flex: 1, background: t.prepared ? 'transparent' : '#22c55e', color: t.prepared ? '#9aa0ad' : '#052e13', border: t.prepared ? '1px solid rgba(255,255,255,0.15)' : 'none', fontWeight: 700, padding: '12px 10px', borderRadius: 12 }}>
                      {t.prepared ? '↩ Vrátit' : '✓ Připraveno'}
                    </button>
                    {t.prepared && (
                      <button type="button" disabled={isBusy} onClick={() => onPullEarlier(t)} className="btn"
                        style={{ flex: 1, background: '#3b82f6', color: '#fff', border: 'none', fontWeight: 700, padding: '12px 10px', borderRadius: 12 }}>
                        ⏩ Posunout výrobu dřív
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </main>

      {toast && (
        <div style={{ position: 'fixed', left: 12, right: 12, bottom: 'calc(16px + env(safe-area-inset-bottom, 0))', background: '#111827', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, padding: '12px 14px', fontSize: 14, zIndex: 50, boxShadow: '0 8px 30px rgba(0,0,0,.5)' }}>
          {toast}
        </div>
      )}
    </div>
  );
}
