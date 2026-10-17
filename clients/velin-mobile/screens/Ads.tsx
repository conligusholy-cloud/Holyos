// =============================================================================
// Ads — Centrum reklamy ve Velínu (jen Tomáš a Jan Holý)
// =============================================================================
// Nativní přehled: výsledky záchytných stránek, funely (čísla v uzlech) a Meta kampaně.
// Data jdou ze stejného API jako web (/api/ads-center/*, token = HolyOS JWT).
// Tlačítko dole otevře celé Centrum reklamy (web) ve WebView — plné ovládání z telefonu.

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { api } from '../lib/api';
import { loadAuth } from '../lib/auth';

const BS = {
  bg: '#04060c', card: 'rgba(14,22,40,0.85)', border: 'rgba(120,160,255,0.16)', border2: 'rgba(120,160,255,0.32)',
  text: '#eaf2ff', text2: '#8ea2c2', text3: '#58698a', accent: '#1e86e0', accent2: '#4fd1ff', vio: '#7c5cff',
  ok: '#2fe3a0', warn: '#fbbf24', err: '#ff7a86',
};
type Period = { key: string; label: string; q: string };
const PERIODS: Period[] = [
  { key: 'today', label: 'Dnes', q: 'days=0' },
  { key: 'yest', label: 'Včera', q: 'days=1&shift=1' },
  { key: '7', label: '7 dní', q: 'days=7' },
  { key: '30', label: '30 dní', q: 'days=30' },
];
const nf = (v: any) => (v == null || v === '' ? '—' : Number(v).toLocaleString('cs-CZ'));
const KIND: Record<string, string> = { start: '🚀 Start', leadform: '📝 Formulář', split: '🔀 Rozdělení', sms: '📱 SMS', email: '✉️ E-mail', landing: '🌐 Záchytná stránka', goals: '🎯 Cíle', result: '🏁 Výsledek', db: '🗄 Databáze', list: '📋 Seznam', note: '🗒 Poznámka', step: '▫️ Krok' };

export default function Ads() {
  const navigation = useNavigation<any>();
  const [period, setPeriod] = useState<Period>(PERIODS[0]);
  const [pages, setPages] = useState<any[]>([]);
  const [funnels, setFunnels] = useState<any[]>([]);
  const [fstats, setFstats] = useState<Record<string, any>>({});
  const [camps, setCamps] = useState<any[] | null>(null);
  const [campErr, setCampErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (quiet?: boolean) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const auth = await loadAuth();
      if (!auth.jwt) throw new Error('Nejsi přihlášený.');
      const jwt = auth.jwt;
      const ov = await api.adsGet(jwt, '/overview?' + period.q);
      setPages((ov.pages || []).filter((p: any) => p.visits != null || p.leads != null));
      // funely + čísla uzlů (neblokuje přehled stránek)
      api.adsGet(jwt, '/funnels').then(async (fl: any) => {
        const list = Array.isArray(fl) ? fl : [];
        setFunnels(list);
        const days = period.key === 'today' ? 0 : period.key === 'yest' ? 1 : period.key === '7' ? 7 : 30;
        const out: Record<string, any> = {};
        for (const f of list.slice(0, 6)) {
          try { out[f.id] = await api.adsGet(jwt, '/funnels/' + encodeURIComponent(f.id) + '/stats?days=' + days); } catch (e) { /* bez čísel */ }
        }
        setFstats(out);
      }).catch(() => setFunnels([]));
      // Meta kampaně (může být nenapojeno)
      api.adsGet(jwt, '/meta/campaigns?' + period.q).then((j: any) => { setCamps(j.campaigns || []); setCampErr(''); }).catch((e: any) => { setCamps(null); setCampErr(e?.message || ''); });
    } catch (e: any) { setError(e?.message || 'Načtení selhalo.'); }
    setLoading(false);
  }, [period]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(true); setRefreshing(false); };

  const totals = pages.reduce((a, p) => ({
    uniques: a.uniques + (Number(p.uniques) || 0), leads: a.leads + (Number(p.leads) || 0),
    conv: a.conv + (Number(p.conversions) || 0), rev: a.rev + (p.currency === 'EUR' ? 0 : (Number(p.revenue) || 0)),
  }), { uniques: 0, leads: 0, conv: 0, rev: 0 });
  const spend = (camps || []).reduce((a, c) => a + (Number(c.spend) || 0), 0);

  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BS.accent2} />}>
        <View style={s.chips}>
          {PERIODS.map((p) => (
            <TouchableOpacity key={p.key} onPress={() => setPeriod(p)} style={[s.chip, period.key === p.key && s.chipOn]}>
              <Text style={[s.chipTxt, period.key === p.key && s.chipTxtOn]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={s.webBtn} activeOpacity={0.8} onPress={() => navigation.navigate('AdsWeb')}>
          <Text style={s.webBtnTxt}>🖥 Otevřít celé Centrum reklamy</Text>
          <Text style={s.webBtnSub}>plné ovládání: funely, editor, ředitel, Meta, nastavení</Text>
        </TouchableOpacity>

        {error ? <Text style={s.err}>{error}</Text> : null}
        {loading ? <ActivityIndicator color={BS.accent2} style={{ marginTop: 30 }} /> : (
          <>
            <View style={s.sumRow}>
              <View style={s.sum}><Text style={s.sumN}>{nf(totals.uniques)}</Text><Text style={s.sumL}>návštěvníků</Text></View>
              <View style={s.sum}><Text style={s.sumN}>{nf(totals.leads)}</Text><Text style={s.sumL}>leadů / žádostí</Text></View>
              <View style={s.sum}><Text style={s.sumN}>{nf(totals.conv)}</Text><Text style={s.sumL}>dokončeno</Text></View>
            </View>
            <View style={s.sumRow}>
              <View style={s.sum}><Text style={s.sumN}>{nf(totals.rev)} Kč</Text><Text style={s.sumL}>tržba</Text></View>
              <View style={s.sum}><Text style={s.sumN}>{camps ? nf(Math.round(spend)) + ' Kč' : '—'}</Text><Text style={s.sumL}>útrata na Metě</Text></View>
            </View>

            <Text style={s.h2}>Záchytné stránky</Text>
            {pages.length === 0 ? <Text style={s.empty}>Žádná data.</Text> : pages.map((p) => (
              <View key={p.key} style={[s.card, { borderLeftColor: p.color || BS.accent, borderLeftWidth: 4 }]}>
                <Text style={s.cardT}>{p.name}</Text>
                <View style={s.metrics}>
                  <View style={s.m}><Text style={s.mN}>{nf(p.uniques)}</Text><Text style={s.mL}>unikátních</Text></View>
                  <View style={s.m}><Text style={s.mN}>{nf(p.visits)}</Text><Text style={s.mL}>zobrazení</Text></View>
                  <View style={s.m}><Text style={s.mN}>{nf(p.leads)}</Text><Text style={s.mL}>{p.leadLabel || 'leady'}</Text></View>
                  <View style={s.m}><Text style={s.mN}>{nf(p.conversions)}</Text><Text style={s.mL}>{p.convLabel || 'dokončeno'}</Text></View>
                </View>
                {p.revenue ? <Text style={s.rev}>Tržba {nf(p.revenue)} {p.currency === 'EUR' ? '€' : 'Kč'}</Text> : null}
                {p.conv_rate != null ? <Text style={s.sub}>Konverze {String(p.conv_rate).replace('.', ',')} %</Text> : null}
                {p.note ? <Text style={s.sub}>{p.note}</Text> : null}
              </View>
            ))}

            <Text style={s.h2}>Funely</Text>
            {funnels.length === 0 ? <Text style={s.empty}>Žádný funel.</Text> : funnels.map((f) => {
              const st = (fstats[f.id] && fstats[f.id].nodes) || {};
              const nodes = (f.nodes || []).filter((nd: any) => nd.kind !== 'note');
              return (
                <View key={f.id} style={s.card}>
                  <Text style={s.cardT}>{f.name || 'Funel'}</Text>
                  {nodes.map((nd: any) => {
                    const v = st[nd.id];
                    const num = v && (v.leads != null ? v.leads : v.sent);
                    return (
                      <View key={nd.id} style={s.nodeRow}>
                        <Text style={s.nodeK}>{KIND[nd.kind] || nd.kind}</Text>
                        <Text style={s.nodeL} numberOfLines={1}>{nd.label || nd.title || ''}</Text>
                        <Text style={s.nodeN}>{num != null ? nf(num) : '—'}</Text>
                      </View>
                    );
                  })}
                </View>
              );
            })}

            <Text style={s.h2}>Meta kampaně</Text>
            {camps === null ? <Text style={s.empty}>{campErr || 'Meta Ads nejsou napojené.'}</Text> : camps.length === 0 ? <Text style={s.empty}>Žádné kampaně v období.</Text> : camps.map((c) => (
              <View key={c.id} style={s.card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[s.cardT, { flex: 1 }]} numberOfLines={2}>{c.name}</Text>
                  <Text style={[s.pill, { color: c.status === 'ACTIVE' ? BS.ok : BS.text2, borderColor: (c.status === 'ACTIVE' ? BS.ok : BS.text2) + '88' }]}>{c.status === 'ACTIVE' ? 'běží' : String(c.status || '').toLowerCase()}</Text>
                </View>
                <View style={s.metrics}>
                  <View style={s.m}><Text style={s.mN}>{nf(Math.round(c.spend || 0))}</Text><Text style={s.mL}>útrata</Text></View>
                  <View style={s.m}><Text style={s.mN}>{nf(c.impressions)}</Text><Text style={s.mL}>zobrazení</Text></View>
                  <View style={s.m}><Text style={s.mN}>{nf(c.clicks)}</Text><Text style={s.mL}>kliků</Text></View>
                  <View style={s.m}><Text style={s.mN}>{c.ctr != null ? String(Math.round(c.ctr * 100) / 100).replace('.', ',') + ' %' : '—'}</Text><Text style={s.mL}>CTR</Text></View>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BS.bg },
  scroll: { padding: 14, paddingBottom: 60 },
  chips: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: { flex: 1, borderWidth: 1, borderColor: BS.border2, borderRadius: 10, paddingVertical: 9, alignItems: 'center', backgroundColor: BS.card },
  chipOn: { backgroundColor: BS.accent, borderColor: BS.accent },
  chipTxt: { color: BS.text2, fontWeight: '700', fontSize: 13 },
  chipTxtOn: { color: '#fff' },
  webBtn: { backgroundColor: 'rgba(124,92,255,0.18)', borderWidth: 1, borderColor: BS.vio, borderRadius: 14, padding: 14, marginBottom: 14 },
  webBtnTxt: { color: BS.text, fontWeight: '800', fontSize: 15 },
  webBtnSub: { color: BS.text2, fontSize: 12, marginTop: 3 },
  sumRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  sum: { flex: 1, backgroundColor: BS.card, borderWidth: 1, borderColor: BS.border, borderRadius: 12, padding: 10 },
  sumN: { color: BS.text, fontSize: 20, fontWeight: '800' },
  sumL: { color: BS.text2, fontSize: 11, marginTop: 2 },
  h2: { color: BS.text, fontSize: 16, fontWeight: '800', marginTop: 18, marginBottom: 8 },
  empty: { color: BS.text3, fontSize: 13, paddingVertical: 8 },
  err: { color: BS.err, marginTop: 10, fontSize: 13 },
  card: { backgroundColor: BS.card, borderWidth: 1, borderColor: BS.border, borderRadius: 14, padding: 12, marginBottom: 10 },
  cardT: { color: BS.text, fontWeight: '800', fontSize: 14.5 },
  metrics: { flexDirection: 'row', marginTop: 10, gap: 6 },
  m: { flex: 1 },
  mN: { color: BS.accent2, fontSize: 17, fontWeight: '800' },
  mL: { color: BS.text2, fontSize: 10.5, marginTop: 1 },
  rev: { color: BS.ok, fontWeight: '700', marginTop: 8, fontSize: 13 },
  sub: { color: BS.text2, fontSize: 12, marginTop: 4 },
  nodeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: BS.border, marginTop: 6 },
  nodeK: { color: BS.text2, fontSize: 12, width: 130 },
  nodeL: { color: BS.text, fontSize: 12.5, flex: 1 },
  nodeN: { color: BS.accent2, fontWeight: '800', fontSize: 15, minWidth: 36, textAlign: 'right' },
  pill: { fontSize: 11.5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, overflow: 'hidden' },
});
