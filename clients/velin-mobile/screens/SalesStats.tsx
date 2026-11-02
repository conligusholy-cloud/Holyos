// =============================================================================
// SalesStats — „Výsledky obchodu": jak si stojí tým a jednotliví obchodníci
// =============================================================================
// Přepínač Dnes / Týden / Měsíc. Nahoře klíčová čísla týmu se srovnáním s předchozím obdobím
// (dnes vs. včera ke stejné hodině, týden/měsíc do dneška vs. stejný úsek minule), plnění cíle
// schůzek a trychtýř hovory → schůzky → proběhlo → prodáno. Dole žebříček obchodníků.
// Jen Tomáš a Jan Holý (server: GET /api/velin/sales/team-stats).

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { api, SalesMetrics, SalesPeriod, SalesTeamStats } from '../lib/api';
import { loadAuth } from '../lib/auth';

const BS = {
  bg: '#04060c', card: 'rgba(14,22,40,0.85)', border: 'rgba(120,160,255,0.16)', text: '#eaf2ff', text2: '#8ea2c2', text3: '#58698a',
  accent: '#1e86e0', accent2: '#4fd1ff', vio: '#7c5cff', ok: '#22c55e', warn: '#eab308', err: '#ff5d6c',
};
type PKey = 'today' | 'week' | 'month';
const TABS: { key: PKey; label: string }[] = [{ key: 'today', label: 'Dnes' }, { key: 'week', label: 'Týden' }, { key: 'month', label: 'Měsíc' }];

function fmtMin(m: number): string { const h = Math.floor(m / 60), mm = Math.round(m % 60); return h ? h + ' h ' + mm + ' min' : mm + ' min'; }
function delta(cur: number, prev: number): { txt: string; col: string } | null {
  if (!prev && !cur) return null;
  if (!prev) return { txt: '▲ nové', col: BS.ok };
  const d = Math.round(((cur - prev) / prev) * 100);
  if (d === 0) return { txt: '= ' + prev, col: BS.text2 };
  return { txt: (d > 0 ? '▲ ' : '▼ ') + Math.abs(d) + ' %', col: d > 0 ? BS.ok : BS.err };
}

function Kpi({ label, value, cur, prev, color, sub }: { label: string; value: string | number; cur?: number; prev?: number; color?: string; sub?: string }) {
  const d = cur != null && prev != null ? delta(cur, prev) : null;
  return (
    <View style={st.kpi}>
      <Text style={st.kpiLbl}>{label}</Text>
      <Text style={[st.kpiVal, color ? { color } : null]}>{value}</Text>
      {d ? <Text style={[st.kpiSub, { color: d.col }]}>{d.txt}</Text> : sub ? <Text style={st.kpiSub}>{sub}</Text> : <Text style={st.kpiSub}> </Text>}
    </View>
  );
}

function Bar({ v, t, color }: { v: number; t: number; color?: string }) {
  const pc = t > 0 ? Math.min(100, Math.round((v / t) * 100)) : 0;
  const col = color || (pc >= 100 ? BS.ok : pc >= 50 ? BS.warn : BS.err);
  return <View style={st.bar}><View style={[st.barIn, { width: `${pc}%` as `${number}%`, backgroundColor: col }]} /></View>;
}

function Funnel({ m }: { m: SalesMetrics }) {
  const steps = [
    { l: 'Hovory', v: m.calls, c: BS.accent2 },
    { l: 'Schůzky', v: m.booked, c: BS.vio },
    { l: 'Proběhlo', v: m.done, c: BS.ok },
    { l: 'Prodáno', v: m.deals, c: '#f5c451' },
  ];
  const mx = Math.max(1, ...steps.map((s) => s.v));
  return (
    <View style={st.card}>
      <Text style={st.cardTitle}>Trychtýř</Text>
      {steps.map((s, i) => {
        const prevV = i > 0 ? steps[i - 1].v : 0;
        const conv = i > 0 && prevV ? Math.round((s.v / prevV) * 1000) / 10 : null;
        return (
          <View key={s.l} style={{ marginTop: 8 }}>
            <View style={st.rowBetween}><Text style={st.fLbl}>{s.l}</Text><Text style={st.fVal}>{s.v}{conv != null ? <Text style={st.fConv}>  {String(conv).replace('.', ',')} %</Text> : null}</Text></View>
            <View style={st.bar}><View style={[st.barIn, { width: `${Math.max(2, Math.round((s.v / mx) * 100))}%` as `${number}%`, backgroundColor: s.c }]} /></View>
          </View>
        );
      })}
    </View>
  );
}

export default function SalesStats() {
  const [data, setData] = useState<SalesTeamStats | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<PKey>('today');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { const a = await loadAuth(); if (!a.jwt) throw new Error('Nejsi přihlášený.'); setData(await api.salesTeamStats(a.jwt)); setErr(''); }
    catch (e: any) { setErr(e?.message || 'Nelze načíst statistiky.'); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const p: SalesPeriod | null = data ? data.periods[tab] : null;
  const t = p ? p.total : null, pv = p ? p.prev : null;

  return (
    <View style={st.root}>
      <View style={st.tabs}>
        {TABS.map((x) => (
          <TouchableOpacity key={x.key} style={[st.tab, tab === x.key && st.tabOn]} onPress={() => setTab(x.key)} activeOpacity={0.75}>
            <Text style={[st.tabTxt, tab === x.key && st.tabTxtOn]}>{x.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView contentContainerStyle={st.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BS.accent2} />}>
        {err ? <Text style={st.err}>{err}</Text> : null}
        {!data && !err ? <ActivityIndicator color={BS.accent2} style={{ marginTop: 40 }} /> : null}
        {p && t && pv ? (
          <>
            <Text style={st.vs}>{p.label} · srovnání: {p.vs} ke stejnému okamžiku</Text>

            {/* Cíl schůzek týmu */}
            <View style={st.card}>
              <View style={st.rowBetween}>
                <Text style={st.cardTitle}>🎯 Schůzky s majitelem</Text>
                <Text style={st.big}>{t.booked}{p.team_target ? <Text style={st.bigOf}> / {p.team_target}</Text> : null}</Text>
              </View>
              {p.team_target ? <Bar v={t.booked} t={p.team_target} /> : <Text style={st.hint}>Cíl schůzek není nastavený (HolyOS → Schůzky obchodníků).</Text>}
              <View style={[st.rowBetween, { marginTop: 8 }]}>
                <Text style={st.hint}>{delta(t.booked, pv.booked)?.txt || ''} vs. {p.vs} ({pv.booked})</Text>
                <Text style={st.hint}>{p.calls_per_meeting != null ? String(p.calls_per_meeting).replace('.', ',') + ' hovorů / schůzku' : ''}</Text>
              </View>
            </View>

            <View style={st.grid}>
              <Kpi label="📞 Hovory" value={t.calls} cur={t.calls} prev={pv.calls} />
              <Kpi label="⏱ Provoláno" value={fmtMin(t.talk_min)} cur={t.talk_min} prev={pv.talk_min} />
              <Kpi label="✅ Proběhlé schůzky" value={t.done} cur={t.done} prev={pv.done} color={BS.ok} />
              <Kpi label="🚫 Nedorazil" value={t.no_show} sub={p.show_rate != null ? 'dorazilo ' + String(p.show_rate).replace('.', ',') + ' %' : undefined} color={t.no_show ? BS.err : undefined} />
              <Kpi label="🏆 Prodáno" value={t.deals} cur={t.deals} prev={pv.deals} color="#f5c451" />
              <Kpi label="🆕 Nové kontakty" value={t.new_leads} cur={t.new_leads} prev={pv.new_leads} />
            </View>

            <Funnel m={t} />

            <View style={st.card}>
              <Text style={st.cardTitle}>📥 Zásoba kontaktů teď</Text>
              <Text style={st.hint}>Nevolaných celkem <Text style={st.strong}>{data!.backlog.total}</Text>{data!.backlog.unassigned ? <Text> · bez obchodníka <Text style={[st.strong, { color: BS.warn }]}>{data!.backlog.unassigned}</Text></Text> : null}</Text>
            </View>

            {/* Žebříček obchodníků */}
            <Text style={st.section}>Obchodníci</Text>
            {p.people.length === 0 ? <Text style={st.hint}>Žádný aktivní obchodník.</Text> : null}
            {p.people.map((x, i) => {
              const idle = tab === 'today' && x.calls === 0 && x.actions === 0;
              return (
                <View key={x.id} style={[st.person, idle && { borderColor: 'rgba(255,93,108,0.45)' }]}>
                  <View style={st.rowBetween}>
                    <Text style={st.pName} numberOfLines={1}>{i < 3 && x.booked > 0 ? ['🥇', '🥈', '🥉'][i] + ' ' : ''}{x.name}{x.lead ? <Text style={st.pLead}>  vedoucí</Text> : null}</Text>
                    <Text style={st.pBig}>{x.booked}{x.target ? <Text style={st.bigOf}> / {x.target}</Text> : null}</Text>
                  </View>
                  {x.target ? <Bar v={x.booked} t={x.target} /> : null}
                  <View style={st.pRow}>
                    <Text style={st.pm}>📞 <Text style={st.strong}>{x.calls}</Text></Text>
                    <Text style={st.pm}>⏱ <Text style={st.strong}>{fmtMin(x.talk_min)}</Text></Text>
                    <Text style={st.pm}>✅ <Text style={st.strong}>{x.done}</Text></Text>
                    <Text style={st.pm}>🚫 <Text style={st.strong}>{x.no_show}</Text></Text>
                    <Text style={st.pm}>🏆 <Text style={st.strong}>{x.deals}</Text></Text>
                  </View>
                  <View style={st.pRow}>
                    <Text style={st.pm2}>{x.calls_per_meeting != null ? String(x.calls_per_meeting).replace('.', ',') + ' hovorů/schůzku' : 'bez schůzky'}</Text>
                    <Text style={st.pm2}>nevoláno {x.backlog}</Text>
                    {idle ? <Text style={[st.pm2, { color: BS.err, fontWeight: '700' }]}>dnes bez aktivity</Text> : null}
                  </View>
                </View>
              );
            })}
            <Text style={st.foot}>Prodáno se počítá podle poslední změny kontaktu ve stavu Prodáno. Stáhni dolů pro obnovení.</Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: BS.bg },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  tab: { flex: 1, borderWidth: 1, borderColor: BS.border, borderRadius: 999, paddingVertical: 8, alignItems: 'center' },
  tabOn: { backgroundColor: 'rgba(79,209,255,0.14)', borderColor: BS.accent2 },
  tabTxt: { color: BS.text2, fontWeight: '700', fontSize: 13 },
  tabTxtOn: { color: BS.accent2 },
  scroll: { paddingHorizontal: 16, paddingBottom: 60 },
  vs: { color: BS.text3, fontSize: 11.5, marginBottom: 8 },
  err: { color: BS.err, marginTop: 20 },
  card: { backgroundColor: BS.card, borderWidth: 1, borderColor: BS.border, borderRadius: 14, padding: 14, marginBottom: 10 },
  cardTitle: { color: BS.text2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  big: { color: BS.text, fontSize: 28, fontWeight: '900' },
  bigOf: { color: BS.text3, fontSize: 15, fontWeight: '600' },
  bar: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden', marginTop: 6 },
  barIn: { height: '100%', borderRadius: 4 },
  hint: { color: BS.text2, fontSize: 12, marginTop: 4 },
  strong: { color: BS.text, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  kpi: { width: '48.5%', backgroundColor: BS.card, borderWidth: 1, borderColor: BS.border, borderRadius: 12, padding: 12, marginBottom: 10 },
  kpiLbl: { color: BS.text2, fontSize: 11.5 },
  kpiVal: { color: BS.text, fontSize: 22, fontWeight: '900', marginTop: 4 },
  kpiSub: { color: BS.text3, fontSize: 11.5, marginTop: 2, fontWeight: '700' },
  fLbl: { color: BS.text, fontSize: 13, fontWeight: '600' },
  fVal: { color: BS.text, fontSize: 13, fontWeight: '800' },
  fConv: { color: BS.text2, fontSize: 11.5, fontWeight: '600' },
  section: { color: BS.text2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 8, marginBottom: 8 },
  person: { backgroundColor: BS.card, borderWidth: 1, borderColor: BS.border, borderRadius: 12, padding: 12, marginBottom: 8 },
  pName: { color: BS.text, fontSize: 15, fontWeight: '800', flex: 1, marginRight: 8 },
  pLead: { color: BS.vio, fontSize: 11, fontWeight: '700' },
  pBig: { color: BS.text, fontSize: 20, fontWeight: '900' },
  pRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  pm: { color: BS.text2, fontSize: 12.5 },
  pm2: { color: BS.text3, fontSize: 11.5 },
  foot: { color: BS.text3, fontSize: 11, marginTop: 14, textAlign: 'center' },
});
