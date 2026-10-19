// =============================================================================
// AdsLive — Reklama v reálném čase (jen Tomáš a Jan Holý)
// =============================================================================
// Kdo je právě na záchytných stránkách BS2, co dělá (čte, vybírá balíček, platí…) a živý proud akcí.
// Data: /api/ads-center/pages/:key/live (BS2 ads-live). Obnovuje se sám každých 6 s, dokud je obrazovka otevřená.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { api } from '../lib/api';
import { loadAuth } from '../lib/auth';

const BS = {
  bg: '#04060c', card: 'rgba(14,22,40,0.85)', border: 'rgba(120,160,255,0.16)', border2: 'rgba(120,160,255,0.32)',
  text: '#eaf2ff', text2: '#8ea2c2', text3: '#58698a', accent: '#1e86e0', accent2: '#4fd1ff', vio: '#7c5cff',
  ok: '#2fe3a0', warn: '#fbbf24', err: '#ff7a86',
};
const POLL_MS = 6000;
const dur = (s: number) => (s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s');
const ago = (s: number) => (s < 5 ? 'teď' : s < 60 ? 'před ' + s + ' s' : s < 3600 ? 'před ' + Math.floor(s / 60) + ' min' : 'před ' + Math.floor(s / 3600) + ' h');

type LivePage = { key: string; name: string; color?: string; data: any };

export default function AdsLive() {
  const navigation = useNavigation<any>();
  const [pages, setPages] = useState<LivePage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [at, setAt] = useState<Date | null>(null);
  const [adsOnly, setAdsOnly] = useState(true);
  const keysRef = useRef<{ key: string; name: string; color?: string }[] | null>(null);
  const alive = useRef(true);
  const lastData = useRef<Record<string, any>>({});

  const load = useCallback(async () => {
    try {
      const auth = await loadAuth();
      if (!auth.jwt) throw new Error('Nejsi přihlášený.');
      const jwt = auth.jwt;
      if (!keysRef.current) {
        // které stránky umí živé sledování (jen BS2) — zjistí se jednou
        const list: any[] = await api.adsGet(jwt, '/pages');
        const probe = await Promise.all((list || []).map(async (p) => {
          try { const d = await api.adsGet(jwt, '/pages/' + encodeURIComponent(p.key) + '/live'); return d && d.supported ? { key: p.key, name: p.name, color: p.color, data: d } : null; } catch (e) { return null; }
        }));
        const ok = probe.filter(Boolean) as LivePage[];
        keysRef.current = ok.map((x) => ({ key: x.key, name: x.name, color: x.color }));
        if (alive.current) setPages(ok);
      } else {
        const out = await Promise.all(keysRef.current.map(async (p) => {
          // při výpadku jednoho dotazu zůstanou poslední známá data (jinak by počty „za 5 / 30 min“ spadly na 0)
          try { return { ...p, data: await api.adsGet(jwt, '/pages/' + encodeURIComponent(p.key) + '/live') } as LivePage; } catch (e) { const prev = lastData.current[p.key]; return { ...p, data: prev || null } as LivePage; }
        }));
        out.forEach((x) => { if (x.data) lastData.current[x.key] = x.data; });
        if (alive.current) setPages(out);
      }
      if (alive.current) { setAt(new Date()); setError(''); }
    } catch (e: any) { if (alive.current) setError(e?.message || 'Načtení selhalo.'); }
    if (alive.current) setLoading(false);
  }, []);

  useEffect(() => {
    alive.current = true; load();
    let timer: any = setInterval(load, POLL_MS);
    const sub = AppState.addEventListener('change', (st) => { clearInterval(timer); if (st === 'active') { load(); timer = setInterval(load, POLL_MS); } });
    return () => { alive.current = false; clearInterval(timer); sub.remove(); };
  }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // Návštěvník z reklamy = zdroj z Facebooku/Instagramu/Googlu/placené kampaně (ne „přímo")
  const isAd = (v: any) => /fb|facebook|insta|\big\b|meta|google|gclid|cpc|paid/i.test(String(v && v.source || ''));
  const viewPages = pages.map((p) => {
    const d = p.data || {};
    const all: any[] = d.visitors || [];
    const vis = adsOnly ? all.filter(isAd) : all;
    const now = adsOnly ? vis.filter((v) => v.active).length : (Number(d.now) || 0);
    // Počty za 5 / 30 min bereme ze seznamu VŠECH nedávných návštěvníků (recent) – seznam „vis“ obsahuje jen aktivní, proto by po odchodu návštěvníka počty mizely
    const rec: any[] = Array.isArray(d.recent) ? d.recent : null as any;
    const l5 = adsOnly ? (rec ? rec.filter((v) => isAd(v) && !v.hidden && (v.last_ago || 0) <= 300).length : vis.filter((v) => (v.last_ago || 0) <= 300).length) : (Number(d.last5) || 0);
    const l30 = adsOnly ? (rec ? rec.filter((v) => isAd(v) && (v.last_ago || 0) <= 1800).length : vis.filter((v) => (v.last_ago || 0) <= 1800).length) : (Number(d.last30) || 0);
    return { p, d, vis, now, l5, l30 };
  }).sort((a, b) => (b.now - a.now) || (b.l5 - a.l5) || (b.l30 - a.l30));
  const nowTotal = viewPages.reduce((a, x) => a + x.now, 0), last5 = viewPages.reduce((a, x) => a + x.l5, 0), last30 = viewPages.reduce((a, x) => a + x.l30, 0);
  const adIds = new Set<string>();
  viewPages.forEach((x) => x.vis.forEach((v) => adIds.add(String(v.id))));
  const feed: { page: string; id: string; ago: number; text: string }[] = [];
  pages.forEach((p) => (p.data && p.data.feed || []).forEach((f: any) => { if (!adsOnly || adIds.has(String(f.id))) feed.push({ page: p.name, id: f.id, ago: f.ago, text: f.text }); }));
  feed.sort((a, b) => a.ago - b.ago);

  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BS.accent2} />}>
        <View style={s.bigRow}>
          <View style={[s.big, { borderColor: nowTotal > 0 ? BS.ok : BS.border2 }]}>
            <View style={s.dotRow}><View style={[s.dot, { backgroundColor: nowTotal > 0 ? BS.ok : BS.text3 }]} /><Text style={s.bigL}>právě teď</Text></View>
            <Text style={s.bigN}>{nowTotal}</Text>
          </View>
          <View style={s.big}><Text style={s.bigL}>za 5 min</Text><Text style={s.bigN2}>{last5}</Text></View>
          <View style={s.big}><Text style={s.bigL}>za 30 min</Text><Text style={s.bigN2}>{last30}</Text></View>
        </View>
        <View style={s.toggle}>
          <TouchableOpacity onPress={() => setAdsOnly(true)} style={[s.tg, adsOnly && s.tgOn]}><Text style={[s.tgT, adsOnly && s.tgTOn]}>📣 Jen z reklamy</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setAdsOnly(false)} style={[s.tg, !adsOnly && s.tgOn]}><Text style={[s.tgT, !adsOnly && s.tgTOn]}>Všichni</Text></TouchableOpacity>
        </View>
        <Text style={s.upd}>{at ? 'Obnoveno ' + at.toLocaleTimeString('cs-CZ') + ' · automaticky každých 6 s' : 'Načítám…'}</Text>
        {error ? <Text style={s.err}>{error}</Text> : null}

        {loading ? <ActivityIndicator color={BS.accent2} style={{ marginTop: 30 }} /> : (
          <>
            {pages.length === 0 ? <Text style={s.empty}>Žádná stránka s živým sledováním.</Text> : null}
            {viewPages.map(({ p, vis, now, l5, l30 }) => {
              return (
                <TouchableOpacity key={p.key} activeOpacity={0.8} onPress={() => navigation.navigate('AdsPage', { key: p.key, name: p.name, color: p.color })} style={[s.card, { borderLeftColor: p.color || BS.accent, borderLeftWidth: 4 }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={[s.cardT, { flex: 1 }]} numberOfLines={2}>{p.name}  ›</Text>
                    <Text style={[s.pill, { color: now > 0 ? BS.ok : BS.text2, borderColor: (now > 0 ? BS.ok : BS.text2) + '88' }]}>{now} online</Text>
                  </View>
                  <Text style={s.sub}>za 5 min: {l5} · za 30 min: {l30}</Text>
                  {vis.length === 0 ? <Text style={s.none}>{adsOnly ? 'Nikdo z reklamy.' : 'Nikdo není na stránce.'}</Text> : vis.slice(0, 12).map((v, i) => (
                    <View key={v.id + i} style={s.vis}>
                      <View style={[s.dot, { backgroundColor: v.active ? BS.ok : BS.text3, marginTop: 5 }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.visT}>{v.id} · {v.device}{v.source ? ' · ' + v.source : ''}{!adsOnly && isAd(v) ? ' 📣' : ''}</Text>
                        <Text style={s.visS}>{v.status}{v.scroll ? ' · scroll ' + v.scroll + ' %' : ''}</Text>
                        <Text style={s.visM}>na stránce {dur(v.secs || 0)} · {v.active ? 'aktivní' : ago(v.last_ago || 0)}{v.last_action ? ' · ' + v.last_action : ''}</Text>
                      </View>
                    </View>
                  ))}
                </TouchableOpacity>
              );
            })}

            <Text style={s.h2}>Poslední akce</Text>
            {feed.length === 0 ? <Text style={s.empty}>Zatím žádné akce za poslední hodinu.</Text> : feed.slice(0, 40).map((f, i) => (
              <View key={i} style={s.feedRow}>
                <Text style={s.feedAgo}>{ago(f.ago)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.feedT}>{f.id} · {f.text}</Text>
                  <Text style={s.feedP}>{f.page}</Text>
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
  bigRow: { flexDirection: 'row', gap: 8 },
  big: { flex: 1, backgroundColor: BS.card, borderWidth: 1, borderColor: BS.border, borderRadius: 14, padding: 12 },
  bigL: { color: BS.text2, fontSize: 11.5 },
  bigN: { color: BS.ok, fontSize: 38, fontWeight: '900', marginTop: 2 },
  bigN2: { color: BS.text, fontSize: 28, fontWeight: '800', marginTop: 6 },
  dotRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  toggle: { flexDirection: 'row', gap: 8, marginTop: 10 },
  tg: { flex: 1, borderWidth: 1, borderColor: BS.border2, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  tgOn: { backgroundColor: BS.accent, borderColor: BS.accent },
  tgT: { color: BS.text2, fontWeight: '700', fontSize: 13 },
  tgTOn: { color: '#fff' },
  upd: { color: BS.text3, fontSize: 11.5, marginTop: 8, marginBottom: 6 },
  err: { color: BS.err, marginTop: 6, fontSize: 13 },
  empty: { color: BS.text3, fontSize: 13, paddingVertical: 8 },
  h2: { color: BS.text, fontSize: 16, fontWeight: '800', marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: BS.card, borderWidth: 1, borderColor: BS.border, borderRadius: 14, padding: 12, marginTop: 10 },
  cardT: { color: BS.text, fontWeight: '800', fontSize: 14.5 },
  sub: { color: BS.text2, fontSize: 12, marginTop: 4 },
  none: { color: BS.text3, fontSize: 12.5, marginTop: 8 },
  pill: { fontSize: 11.5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, overflow: 'hidden' },
  vis: { flexDirection: 'row', gap: 8, paddingTop: 8, marginTop: 8, borderTopWidth: 1, borderTopColor: BS.border },
  visT: { color: BS.text, fontWeight: '700', fontSize: 13 },
  visS: { color: BS.accent2, fontSize: 12.5, marginTop: 1 },
  visM: { color: BS.text2, fontSize: 11.5, marginTop: 1 },
  feedRow: { flexDirection: 'row', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: BS.border },
  feedAgo: { color: BS.text3, fontSize: 11.5, width: 74 },
  feedT: { color: BS.text, fontSize: 13 },
  feedP: { color: BS.text3, fontSize: 11, marginTop: 1 },
});
