// =============================================================================
// AdsPage — jedna záchytná stránka: živě + historie (dnes / včera / 7 / 30 dní)
// =============================================================================
// Otevírá se klepnutím na kartu stránky v „Reklama živě". Živá část se obnovuje každých 6 s,
// historická čísla jdou z /api/ads-center/overview (stejné jako přehled Reklamy).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import { api } from '../lib/api';
import { loadAuth } from '../lib/auth';

const BS = {
  bg: '#04060c', card: 'rgba(14,22,40,0.85)', border: 'rgba(120,160,255,0.16)', border2: 'rgba(120,160,255,0.32)',
  text: '#eaf2ff', text2: '#8ea2c2', text3: '#58698a', accent: '#1e86e0', accent2: '#4fd1ff', vio: '#7c5cff',
  ok: '#2fe3a0', warn: '#fbbf24', err: '#ff7a86',
};
const POLL_MS = 6000;
const PERIODS = [
  { key: 'today', label: 'Dnes', q: 'days=0' },
  { key: 'yest', label: 'Včera', q: 'days=1&shift=1' },
  { key: '7', label: '7 dní', q: 'days=7' },
  { key: '30', label: '30 dní', q: 'days=30' },
];
const nf = (v: any) => (v == null || v === '' ? '—' : Number(v).toLocaleString('cs-CZ'));
const dur = (s: number) => (s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s');
const ago = (s: number) => (s < 5 ? 'teď' : s < 60 ? 'před ' + s + ' s' : s < 3600 ? 'před ' + Math.floor(s / 60) + ' min' : 'před ' + Math.floor(s / 3600) + ' h');
const isAd = (v: any) => /fb|facebook|insta|\big\b|meta|google|gclid|cpc|paid/i.test(String(v && v.source || ''));

// Hodnocení reklamy: dobrá / průměrná / neefektivní (+ málo dat). Porovnává se s průměrem reklam na stránce.
// Nejdůležitější je cena za schůzku; bez schůzek rozhoduje útrata vs. průměrná cena schůzky a kvalita prokliků (CTR, cena/klik).
function rateAd(a: any, ctx: any) {
  const spend = Number(a.spend) || 0, imp = Number(a.impressions) || 0, clicks = Number(a.clicks) || 0;
  const ctr = a.ctr != null ? Number(a.ctr) : (imp ? (clicks / imp) * 100 : null);
  const cpc = clicks ? spend / clicks : null;
  const T = ctx && ctx.totals ? ctx.totals : null;
  const avgCpc = T && T.clicks ? T.spend / T.clicks : null;
  const avgCpm = ctx && ctx.cost_per_meeting != null ? Number(ctx.cost_per_meeting) : null; // průměrná cena schůzky na stránce
  const GOOD = { label: 'Dobrá', color: BS.ok, icon: '🟢' }, AVG = { label: 'Průměrná', color: BS.warn, icon: '🟡' }, BAD = { label: 'Neefektivní', color: BS.err, icon: '🔴' }, FEW = { label: 'Málo dat', color: BS.text2, icon: '⏳' };
  const fmt = (n: number) => Math.round(n).toLocaleString('cs-CZ');
  if (spend < 300 || imp < 1500) return { ...FEW, reason: 'Zatím nízká útrata (' + fmt(spend) + ' Kč) / zobrazení – hodnotit až po vyšším vzorku.', action: 'Nechat běžet' };
  if (a.meetings != null && a.meetings > 0) {
    const cm = spend / a.meetings;
    if (!avgCpm || cm <= avgCpm * 1.15) return { ...GOOD, reason: a.meetings + '× schůzka za ' + fmt(cm) + ' Kč' + (avgCpm ? ' (průměr stránky ' + fmt(avgCpm) + ' Kč)' : ''), action: 'Ponechat, zvážit navýšení rozpočtu' };
    if (cm <= avgCpm * 2) return { ...AVG, reason: 'Schůzka vychází na ' + fmt(cm) + ' Kč, průměr stránky ' + fmt(avgCpm) + ' Kč', action: 'Ponechat, sledovat; vyzkoušet nový text' };
    return { ...BAD, reason: 'Schůzka za ' + fmt(cm) + ' Kč – víc než dvojnásobek průměru stránky (' + fmt(avgCpm) + ' Kč)', action: 'Zvážit vypnutí nebo výměnu kreativy' };
  }
  const limit = avgCpm ? avgCpm * 1.5 : 2000;
  if (a.meetings != null && spend >= limit && clicks >= 40) return { ...BAD, reason: 'Utraceno ' + fmt(spend) + ' Kč, ' + fmt(clicks) + ' kliků a žádná schůzka', action: 'Doporučuji VYPNOUT / nahradit' };
  if (ctr != null && ctr >= 1.5 && (avgCpc == null || (cpc != null && cpc <= avgCpc * 1.1))) return { ...GOOD, reason: 'Silný CTR ' + String(Math.round(ctr * 100) / 100).replace('.', ',') + ' % a levné prokliky; schůzka zatím nepřišla', action: 'Ponechat, sledovat konverzi stránky' };
  if (ctr != null && ctr < 0.8 && cpc != null && avgCpc != null && cpc > avgCpc * 1.3) return { ...BAD, reason: 'Nízký CTR ' + String(Math.round(ctr * 100) / 100).replace('.', ',') + ' % a drahý klik (' + String(Math.round(cpc * 100) / 100).replace('.', ',') + ' Kč)', action: 'Doporučuji vypnout nebo přepsat text' };
  return { ...AVG, reason: 'Zatím bez schůzky' + (ctr != null ? ', CTR ' + String(Math.round(ctr * 100) / 100).replace('.', ',') + ' %' : '') + (cpc != null ? ', klik ' + String(Math.round(cpc * 100) / 100).replace('.', ',') + ' Kč' : ''), action: 'Sledovat' };
}

// Jednoduché zobrazení Markdownu z AI analýzy (nadpisy, odrážky, tabulky jako řádky, tučné bez hvězdiček)
function MdView({ text }: { text: string }) {
  const lines = String(text || '').split('\n');
  const clean = (t: string) => t.replace(/\*\*/g, '').replace(/`/g, '');
  return (
    <View>
      {lines.map((ln, i) => {
        const t = ln.trim();
        if (!t) return <View key={i} style={{ height: 6 }} />;
        if (/^\|?[\s:-]+(\|[\s:-]+)+\|?$/.test(t)) return null; // oddělovač tabulky
        if (/^#{1,3}\s/.test(t)) return <Text key={i} style={s.mdH}>{clean(t.replace(/^#+\s*/, ''))}</Text>;
        if (t.startsWith('|')) return <Text key={i} style={s.mdRow}>{clean(t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).join('  ·  '))}</Text>;
        if (/^[-*•]\s/.test(t)) return <Text key={i} style={s.mdLi}>•  {clean(t.replace(/^[-*•]\s+/, ''))}</Text>;
        if (/^\d+\.\s/.test(t)) return <Text key={i} style={s.mdLi}>{clean(t)}</Text>;
        return <Text key={i} style={s.mdP}>{clean(t)}</Text>;
      })}
    </View>
  );
}

export default function AdsPage() {
  const route = useRoute<any>();
  const { key, name, color } = (route.params || {}) as { key: string; name: string; color?: string };
  const [live, setLive] = useState<any>(null);
  const [liveErr, setLiveErr] = useState('');
  const [at, setAt] = useState<Date | null>(null);
  const [adsOnly, setAdsOnly] = useState(true);
  const [period, setPeriod] = useState(PERIODS[0]);
  const [hist, setHist] = useState<any>(null);
  const [adsData, setAdsData] = useState<any>(null);
  const [adsErr, setAdsErr] = useState('');
  const [adsLoading, setAdsLoading] = useState(false);
  const [histLoading, setHistLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(true);
  const [ai, setAi] = useState<any>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const [aiOpen, setAiOpen] = useState(false);

  // Hloubková AI analýza stránky + reklam (běží na serveru 1–3 min, průběh se dotazuje)
  const runAi = async () => {
    if (aiBusy) return;
    setAiBusy(true); setAiOpen(true); setAiMsg('Spouštím analýzu…');
    try {
      const auth = await loadAuth(); if (!auth.jwt) throw new Error('Nejsi přihlášený.');
      const days = period.key === '7' ? 7 : 30; // pro smysluplnou analýzu aspoň týden
      const st: any = await api.adsPost(auth.jwt, '/pages/' + encodeURIComponent(key) + '/deep-analysis?days=' + days);
      for (let i = 0; i < 130 && alive.current; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const j: any = await api.adsGet(auth.jwt, '/deep-analysis/job/' + encodeURIComponent(st.job));
        if (j.status === 'error') throw new Error(j.error || 'Analýza selhala.');
        if (j.status === 'done') { if (alive.current) { setAi(j.result); setAiMsg(''); } break; }
        if (alive.current) setAiMsg((j.progress || 'Pracuji…') + ' · ' + (j.elapsed_s || 0) + ' s');
      }
    } catch (e: any) { if (alive.current) setAiMsg('Analýza se nezdařila: ' + (e?.message || 'chyba')); }
    if (alive.current) setAiBusy(false);
  };
  useEffect(() => {
    (async () => { try { const auth = await loadAuth(); if (!auth.jwt) return; const x: any = await api.adsGet(auth.jwt, '/pages/' + encodeURIComponent(key) + '/deep-analysis/last'); if (x && x.text && alive.current) setAi(x); } catch (e) { /* bez poslední analýzy */ } })();
  }, [key]);

  const loadLive = useCallback(async () => {
    try {
      const auth = await loadAuth();
      if (!auth.jwt) throw new Error('Nejsi přihlášený.');
      const d = await api.adsGet(auth.jwt, '/pages/' + encodeURIComponent(key) + '/live');
      if (alive.current) { setLive(d); setAt(new Date()); setLiveErr(''); }
    } catch (e: any) { if (alive.current) setLiveErr(e?.message || 'Živá data se nenačetla.'); }
  }, [key]);

  const loadHist = useCallback(async () => {
    setHistLoading(true);
    try {
      const auth = await loadAuth();
      if (!auth.jwt) throw new Error('Nejsi přihlášený.');
      const ov = await api.adsGet(auth.jwt, '/overview?' + period.q);
      const p = (ov.pages || []).find((x: any) => x.key === key) || null;
      if (alive.current) setHist(p);
      // reklamy na tuto stránku + útrata (Meta) — načítá se zvlášť, ať nezdržuje čísla stránky
      setAdsLoading(true);
      api.adsGet(auth.jwt, '/pages/' + encodeURIComponent(key) + '/ads?' + period.q)
        .then((j: any) => { if (alive.current) { setAdsData(j); setAdsErr(''); } })
        .catch((e: any) => { if (alive.current) { setAdsData(null); setAdsErr(e?.message || 'Reklamy se nenačetly.'); } })
        .finally(() => { if (alive.current) setAdsLoading(false); });
    } catch (e) { if (alive.current) setHist(null); }
    if (alive.current) setHistLoading(false);
  }, [key, period]);

  useEffect(() => {
    alive.current = true; loadLive();
    let timer: any = setInterval(loadLive, POLL_MS);
    const sub = AppState.addEventListener('change', (st) => { clearInterval(timer); if (st === 'active') { loadLive(); timer = setInterval(loadLive, POLL_MS); } });
    return () => { alive.current = false; clearInterval(timer); sub.remove(); };
  }, [loadLive]);
  useEffect(() => { loadHist(); }, [loadHist]);

  const onRefresh = async () => { setRefreshing(true); await Promise.all([loadLive(), loadHist()]); setRefreshing(false); };

  const d = live || {};
  const all: any[] = d.visitors || [];
  const vis = adsOnly ? all.filter(isAd) : all;
  const now = adsOnly ? vis.filter((v) => v.active).length : (Number(d.now) || 0);
  // Počty za 5 / 30 min ze seznamu VŠECH nedávných návštěvníků (recent) — seznam „vis" obsahuje jen aktivní, po odchodu by počty mizely
  const rec: any[] | null = Array.isArray(d.recent) ? d.recent : null;
  const l5 = adsOnly ? (rec ? rec.filter((v) => isAd(v) && !v.hidden && (v.last_ago || 0) <= 300).length : vis.filter((v) => (v.last_ago || 0) <= 300).length) : (Number(d.last5) || 0);
  const l30 = adsOnly ? (rec ? rec.filter((v) => isAd(v) && (v.last_ago || 0) <= 1800).length : vis.filter((v) => (v.last_ago || 0) <= 1800).length) : (Number(d.last30) || 0);
  const ids = new Set(vis.map((v) => String(v.id)));
  const feed: any[] = ((d.feed || []) as any[]).filter((f) => !adsOnly || ids.has(String(f.id))).sort((a, b) => a.ago - b.ago);
  const accent = color || BS.accent;

  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BS.accent2} />}>
        <Text style={[s.title, { borderLeftColor: accent }]}>{name}</Text>
        <TouchableOpacity onPress={() => (ai && !aiBusy ? setAiOpen(!aiOpen) : runAi())} activeOpacity={0.8} style={s.aiBtn}>
          <Text style={s.aiBtnT}>{aiBusy ? '🧠 Analyzuji…' : ai ? (aiOpen ? '🧠 Skrýt AI analýzu' : '🧠 Zobrazit poslední AI analýzu') : '🧠 AI analýza stránky a reklam'}</Text>
        </TouchableOpacity>
        {aiOpen ? (
          <View style={s.aiBox}>
            {aiMsg ? <Text style={s.sub}>{aiBusy ? <ActivityIndicator color={BS.accent2} size="small" /> : null} {aiMsg}</Text> : null}
            {ai ? (
              <>
                <Text style={s.aiMeta}>{new Date(ai.at).toLocaleString('cs-CZ')} · období {ai.days} dní</Text>
                <MdView text={ai.text} />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <TouchableOpacity onPress={runAi} disabled={aiBusy} style={[s.tg, { flex: 1 }]}><Text style={s.tgT}>↻ Nová analýza</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setAiOpen(false)} style={[s.tg, { flex: 1 }]}><Text style={s.tgT}>Zavřít</Text></TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        <Text style={s.h2}>🟢 Živě</Text>
        <View style={s.bigRow}>
          <View style={[s.big, { borderColor: now > 0 ? BS.ok : BS.border2 }]}>
            <View style={s.dotRow}><View style={[s.dot, { backgroundColor: now > 0 ? BS.ok : BS.text3 }]} /><Text style={s.bigL}>právě teď</Text></View>
            <Text style={s.bigN}>{now}</Text>
          </View>
          <View style={s.big}><Text style={s.bigL}>za 5 min</Text><Text style={s.bigN2}>{l5}</Text></View>
          <View style={s.big}><Text style={s.bigL}>za 30 min</Text><Text style={s.bigN2}>{l30}</Text></View>
        </View>
        <View style={s.toggle}>
          <TouchableOpacity onPress={() => setAdsOnly(true)} style={[s.tg, adsOnly && s.tgOn]}><Text style={[s.tgT, adsOnly && s.tgTOn]}>📣 Jen z reklamy</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setAdsOnly(false)} style={[s.tg, !adsOnly && s.tgOn]}><Text style={[s.tgT, !adsOnly && s.tgTOn]}>Všichni</Text></TouchableOpacity>
        </View>
        <Text style={s.upd}>{at ? 'Obnoveno ' + at.toLocaleTimeString('cs-CZ') + ' · automaticky každých 6 s' : 'Načítám…'}</Text>
        {liveErr ? <Text style={s.err}>{liveErr}</Text> : null}
        {live && live.supported === false ? <Text style={s.empty}>Tahle stránka nemá živé sledování, jen historická čísla níže.</Text> : null}

        {vis.length === 0 && live && live.supported !== false ? <Text style={s.empty}>{adsOnly ? 'Nikdo z reklamy.' : 'Nikdo není na stránce.'}</Text> : vis.slice(0, 20).map((v, i) => (
          <View key={v.id + i} style={s.vis}>
            <View style={[s.dot, { backgroundColor: v.active ? BS.ok : BS.text3, marginTop: 5 }]} />
            <View style={{ flex: 1 }}>
              <Text style={s.visT}>{v.id} · {v.device}{v.source ? ' · ' + v.source : ''}{!adsOnly && isAd(v) ? ' 📣' : ''}</Text>
              <Text style={s.visS}>{v.status}{v.scroll ? ' · scroll ' + v.scroll + ' %' : ''}</Text>
              <Text style={s.visM}>na stránce {dur(v.secs || 0)} · {v.active ? 'aktivní' : ago(v.last_ago || 0)}{v.last_action ? ' · ' + v.last_action : ''}</Text>
            </View>
          </View>
        ))}

        {feed.length > 0 ? <Text style={s.h3}>Poslední akce</Text> : null}
        {feed.slice(0, 25).map((f, i) => (
          <View key={i} style={s.feedRow}>
            <Text style={s.feedAgo}>{ago(f.ago)}</Text>
            <Text style={s.feedT}>{f.id} · {f.text}</Text>
          </View>
        ))}

        <Text style={[s.h2, { marginTop: 24 }]}>📊 Historie</Text>
        <View style={s.chips}>
          {PERIODS.map((p) => (
            <TouchableOpacity key={p.key} onPress={() => setPeriod(p)} style={[s.chip, period.key === p.key && s.chipOn]}>
              <Text style={[s.chipTxt, period.key === p.key && s.chipTxtOn]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {histLoading ? <ActivityIndicator color={BS.accent2} style={{ marginTop: 16 }} /> : !hist ? <Text style={s.empty}>Žádná data za toto období.</Text> : (
          <View style={s.card}>
            {adsOnly && adsData && adsData.ad_visitors != null ? (
              <>
                <View style={s.metrics}>
                  <View style={s.m}><Text style={[s.mN, { color: BS.ok }]}>{nf(adsData.ad_visitors)}</Text><Text style={s.mL}>lidí z reklamy na webu</Text></View>
                  <View style={s.m}><Text style={s.mN}>{nf(adsData.totals ? adsData.totals.clicks : null)}</Text><Text style={s.mL}>kliků na reklamě</Text></View>
                  <View style={s.m}><Text style={s.mN}>{adsData.totals && adsData.totals.clicks ? Math.round((adsData.ad_visitors / adsData.totals.clicks) * 100) + ' %' : '—'}</Text><Text style={s.mL}>dorazilo na web</Text></View>
                </View>
                <View style={[s.metrics, { marginTop: 12 }]}>
                  <View style={s.m}><Text style={s.mN}>{nf(hist.leads)}</Text><Text style={s.mL}>{hist.leadLabel || 'leady'}</Text></View>
                  <View style={s.m}><Text style={s.mN}>{nf(hist.conversions)}</Text><Text style={s.mL}>{hist.convLabel || 'dokončeno'}</Text></View>
                  {adsData.totals && adsData.totals.landing_views ? <View style={s.m}><Text style={s.mN}>{nf(adsData.totals.landing_views)}</Text><Text style={s.mL}>zobrazení stránky (Meta)</Text></View> : null}
                </View>
              </>
            ) : (
            <>
            <View style={s.metrics}>
              <View style={s.m}><Text style={s.mN}>{nf(hist.uniques)}</Text><Text style={s.mL}>unikátních</Text></View>
              <View style={s.m}><Text style={s.mN}>{nf(hist.visits)}</Text><Text style={s.mL}>zobrazení</Text></View>
              <View style={s.m}><Text style={s.mN}>{nf(hist.leads)}</Text><Text style={s.mL}>{hist.leadLabel || 'leady'}</Text></View>
              <View style={s.m}><Text style={s.mN}>{nf(hist.conversions)}</Text><Text style={s.mL}>{hist.convLabel || 'dokončeno'}</Text></View>
            </View>
            {hist.revenue ? <Text style={s.rev}>Tržba {nf(hist.revenue)} {hist.currency === 'EUR' ? '€' : 'Kč'}</Text> : null}
            {hist.conv_rate != null ? <Text style={s.sub}>Konverze {String(hist.conv_rate).replace('.', ',')} %</Text> : null}
            {hist.note ? <Text style={s.sub}>{hist.note}</Text> : null}
            </>
            )}
          </View>
        )}

        <Text style={[s.h2, { marginTop: 24 }]}>📣 Reklamy na tuto stránku</Text>
        {adsLoading ? <ActivityIndicator color={BS.accent2} style={{ marginTop: 10 }} /> : adsErr ? <Text style={s.err}>{adsErr}</Text> : !adsData ? null : adsData.connected === false ? <Text style={s.empty}>Meta Ads nejsou napojené.</Text> : (
          <>
            {adsData.ads.length === 0 ? <Text style={s.empty}>V tomto období neběžela žádná reklama s odkazem na tuto stránku.</Text> : (
              <>
                <View style={s.card}>
                  <View style={s.metrics}>
                    <View style={s.m}><Text style={s.mN}>{nf(Math.round(adsData.totals.spend))} Kč</Text><Text style={s.mL}>útrata</Text></View>
                    <View style={s.m}><Text style={s.mN}>{nf(adsData.totals.clicks)}</Text><Text style={s.mL}>kliků na web</Text></View>
                    <View style={s.m}><Text style={s.mN}>{nf(adsData.totals.unique_clicks)}</Text><Text style={s.mL}>unikátních kliků</Text></View>
                    <View style={s.m}><Text style={s.mN}>{adsData.totals.clicks ? nf(Math.round((adsData.totals.spend / adsData.totals.clicks) * 100) / 100) + ' Kč' : '—'}</Text><Text style={s.mL}>cena / klik</Text></View>
                  </View>
                  <View style={[s.metrics, { marginTop: 12 }]}>
                    <View style={s.m}><Text style={s.mN} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>{(() => { const n = adsData.ad_visitors != null ? adsData.ad_visitors : (hist && hist.uniques); return n ? nf(Math.round(adsData.totals.spend / n)) + ' Kč' : '—'; })()}</Text><Text style={s.mL}>cena / návštěvník z reklamy</Text></View>
                    {adsData.meetings != null ? <View style={s.m}><Text style={s.mN}>{nf(adsData.meetings)}</Text><Text style={s.mL}>schůzek</Text></View> : null}
                    {adsData.meetings_duplicates ? <View style={s.m}><Text style={[s.mN, { color: BS.warn }]}>{nf(adsData.meetings_duplicates)}</Text><Text style={s.mL}>duplicitních</Text></View> : null}
                    {adsData.meetings_canceled != null ? <View style={s.m}><Text style={[s.mN, { color: adsData.meetings_canceled > 0 ? BS.warn : BS.accent2 }]}>{nf(adsData.meetings_canceled)}</Text><Text style={s.mL}>zrušeno</Text></View> : null}
                    {adsData.meetings != null ? <View style={s.m}><Text style={[s.mN, { color: BS.ok }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>{adsData.cost_per_meeting != null ? nf(Math.round(adsData.cost_per_meeting)) + ' Kč' : '—'}</Text><Text style={s.mL}>cena / schůzka</Text></View> : null}
                  </View>
                </View>
                {adsData.ads.map((a: any) => { const rt = rateAd(a, adsData); return (
                  <View key={a.id} style={[s.card, { marginTop: 8, borderLeftWidth: 4, borderLeftColor: rt.color }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={[s.cardT, { flex: 1 }]} numberOfLines={2}>{a.name}</Text>
                      <Text style={[s.pill, { color: a.status === 'ACTIVE' ? BS.ok : BS.text2, borderColor: (a.status === 'ACTIVE' ? BS.ok : BS.text2) + '88' }]}>{a.status === 'ACTIVE' ? 'běží' : String(a.status || '—').toLowerCase()}</Text>
                    </View>
                    <Text style={s.sub} numberOfLines={1}>{a.campaign}</Text>
                    <View style={[s.rate, { borderColor: rt.color + '99', backgroundColor: rt.color + '1f' }]}>
                      <Text style={[s.rateT, { color: rt.color }]}>{rt.icon} {rt.label}</Text>
                      <Text style={s.rateR}>{rt.reason}</Text>
                      <Text style={[s.rateA, { color: rt.color }]}>{rt.action}</Text>
                    </View>
                    <View style={s.metrics}>
                      <View style={s.m}><Text style={s.mN}>{nf(Math.round(a.spend))}</Text><Text style={s.mL}>útrata Kč</Text></View>
                      <View style={s.m}><Text style={s.mN}>{nf(a.impressions)}</Text><Text style={s.mL}>zobrazení</Text></View>
                      <View style={s.m}><Text style={s.mN}>{nf(a.clicks)}</Text><Text style={s.mL}>kliků</Text></View>
                      <View style={s.m}><Text style={s.mN}>{nf(a.unique_clicks)}</Text><Text style={s.mL}>unikátních kliků</Text></View>
                      <View style={s.m}><Text style={s.mN}>{a.ctr != null ? String(Math.round(a.ctr * 100) / 100).replace('.', ',') + ' %' : '—'}</Text><Text style={s.mL}>CTR</Text></View>
                    </View>
                    {a.meetings != null ? (
                      <View style={[s.metrics, { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: BS.border }]}>
                        <View style={s.m}><Text style={s.mN}>{nf(a.meetings)}</Text><Text style={s.mL}>schůzek z této reklamy</Text></View>
                        <View style={s.m}><Text style={[s.mN, { color: BS.ok }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>{a.cost_per_meeting != null ? nf(Math.round(a.cost_per_meeting)) + ' Kč' : '—'}</Text><Text style={s.mL}>cena / schůzka</Text></View>
                        <View style={s.m}><Text style={s.mN}>{a.clicks ? nf(Math.round((a.spend / a.clicks) * 100) / 100) + ' Kč' : '—'}</Text><Text style={s.mL}>cena / klik</Text></View>
                      </View>
                    ) : null}
                  </View>
                ); })}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BS.bg },
  scroll: { padding: 14, paddingBottom: 60 },
  title: { color: BS.text, fontSize: 18, fontWeight: '800', borderLeftWidth: 4, paddingLeft: 10, marginBottom: 6 },
  h2: { color: BS.text, fontSize: 16, fontWeight: '800', marginTop: 14, marginBottom: 8 },
  h3: { color: BS.text, fontSize: 14, fontWeight: '800', marginTop: 16, marginBottom: 4 },
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
  vis: { flexDirection: 'row', gap: 8, paddingTop: 8, marginTop: 8, borderTopWidth: 1, borderTopColor: BS.border },
  visT: { color: BS.text, fontWeight: '700', fontSize: 13 },
  visS: { color: BS.accent2, fontSize: 12.5, marginTop: 1 },
  visM: { color: BS.text2, fontSize: 11.5, marginTop: 1 },
  feedRow: { flexDirection: 'row', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: BS.border },
  feedAgo: { color: BS.text3, fontSize: 11.5, width: 74 },
  feedT: { color: BS.text, fontSize: 13, flex: 1 },
  chips: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  chip: { flex: 1, borderWidth: 1, borderColor: BS.border2, borderRadius: 10, paddingVertical: 9, alignItems: 'center', backgroundColor: BS.card },
  chipOn: { backgroundColor: BS.accent, borderColor: BS.accent },
  chipTxt: { color: BS.text2, fontWeight: '700', fontSize: 13 },
  chipTxtOn: { color: '#fff' },
  card: { backgroundColor: BS.card, borderWidth: 1, borderColor: BS.border, borderRadius: 14, padding: 12 },
  metrics: { flexDirection: 'row', gap: 6 },
  m: { flex: 1 },
  mN: { color: BS.accent2, fontSize: 17, fontWeight: '800' },
  mL: { color: BS.text2, fontSize: 10.5, marginTop: 1 },
  rev: { color: BS.ok, fontWeight: '700', marginTop: 8, fontSize: 13 },
  sub: { color: BS.text2, fontSize: 12, marginTop: 4 },
  cardT: { color: BS.text, fontWeight: '800', fontSize: 14 },
  aiBtn: { backgroundColor: 'rgba(245,158,11,0.14)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.6)', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 4, marginBottom: 6 },
  aiBtnT: { color: '#fbbf24', fontWeight: '800', fontSize: 14 },
  aiBox: { backgroundColor: BS.card, borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)', borderRadius: 14, padding: 12, marginBottom: 8 },
  aiMeta: { color: BS.text3, fontSize: 11.5, marginBottom: 6 },
  mdH: { color: BS.accent2, fontSize: 15, fontWeight: '800', marginTop: 12, marginBottom: 4 },
  mdP: { color: BS.text, fontSize: 13, lineHeight: 19 },
  mdLi: { color: BS.text, fontSize: 13, lineHeight: 19, paddingLeft: 4 },
  mdRow: { color: BS.text2, fontSize: 12, lineHeight: 17, paddingVertical: 2 },
  rate: { borderWidth: 1, borderRadius: 10, padding: 8, marginTop: 8 },
  rateT: { fontWeight: '800', fontSize: 13.5 },
  rateR: { color: BS.text2, fontSize: 12, marginTop: 2 },
  rateA: { fontWeight: '700', fontSize: 12, marginTop: 3 },
  pill: { fontSize: 11.5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1, overflow: 'hidden' },
});
