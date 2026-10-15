// =============================================================================
// AssistantSettings — vzkazy osobního asistenta (přehrát + přečíst přímo ve Velínu)
// =============================================================================
// Seznam zmeškaných hovorů, které vzal osobní AI asistent. Po rozkliknutí:
// shrnutí, přehrávač nahrávky (WebView <audio> nad podepsaným odkazem HolyOS —
// hraje bez přihlášení k Twiliu) a celý přepis hovoru jako konverzace.
// Push notifikace „Nový vzkaz asistenta" otevře tuto obrazovku s konkrétním hovorem.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useNavigation, useRoute } from '@react-navigation/native';
import { loadAuth } from '../lib/auth';
import { api, apiBase, AssistantCall } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('cs-CZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function fmtDur(sec: number | null): string {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? m + ' min ' + s + ' s' : s + ' s';
}

// Přehrávač: HTML5 <audio> ve WebView (expo-av v aplikaci není). Tmavý vzhled, plná šířka.
function audioHtml(src: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:transparent;color-scheme:dark">
<audio controls preload="metadata" style="width:100%;height:48px" src="${src.replace(/"/g, '&quot;')}"></audio>
</body></html>`;
}

type Turn = { who: 'agent' | 'caller'; text: string };
function turnsOf(c: AssistantCall): Turn[] {
  if (Array.isArray(c.transcript) && c.transcript.length) {
    return c.transcript
      .filter((t) => t && t.text && String(t.text).trim())
      .map((t) => ({ who: t.role === 'agent' ? 'agent' : 'caller', text: String(t.text).trim() }));
  }
  return [];
}

export default function AssistantSettings() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  // Zpět: do předchozí obrazovky, a když žádná není (otevřeno z notifikace), na hlavní obrazovku Velína
  const goBack = () => { if (navigation.canGoBack()) navigation.goBack(); else navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] }); };
  const focusId: string | undefined = route?.params?.callId ? String(route.params.callId) : undefined;
  const [calls, setCalls] = useState<AssistantCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(focusId || null);
  const [fullFor, setFullFor] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const cardY = useRef<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const auth = await loadAuth();
      if (!auth.jwt) throw new Error('Chybí přihlášení.');
      const r = await api.myAssistantCalls(auth.jwt);
      setCalls(Array.isArray(r.calls) ? r.calls : []);
    } catch (e: any) {
      setError(e?.message || 'Vzkazy se nepodařilo načíst.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Přečtení: otevřením vzkazu se označí jako přečtený (lokálně hned + na serveru); lze vrátit na nepřečtený
  const setRead = useCallback(async (id: string, read: boolean) => {
    setCalls((cs) => cs.map((x) => (x.id === id ? { ...x, read } : x)));
    try { const auth = await loadAuth(); if (auth.jwt) await api.markAssistantCallRead(auth.jwt, id, read); } catch { /* zkusí se příště */ }
  }, []);
  const toggleOpen = (c: AssistantCall) => {
    const willOpen = openId !== c.id;
    setOpenId(willOpen ? c.id : null);
    if (willOpen && !c.read) setRead(c.id, true);
  };
  const unreadCount = calls.filter((c) => !c.read).length;

  // Otevření z notifikace: rozbal daný hovor, označ jako přečtený a odscrolluj na něj
  useEffect(() => {
    if (!focusId) return;
    setOpenId(focusId);
    const fc = calls.find((x) => x.id === focusId); if (fc && !fc.read) setRead(focusId, true);
    const t = setTimeout(() => {
      const y = cardY.current[focusId];
      if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 10), animated: true });
    }, 350);
    return () => clearTimeout(t);
  }, [focusId, calls.length]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}>
        <TouchableOpacity onPress={goBack} style={styles.back} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backTxt}>‹ Zpět</Text>
        </TouchableOpacity>
        <Text style={styles.h1}>📩 Vzkazy asistenta</Text>
        <Text style={styles.sub}>Hovory, které jsi nezvedl a vzal je tvůj AI asistent.{unreadCount ? '  ·  ' : ''}{unreadCount ? <Text style={styles.subNew}>{unreadCount} nepřečten{unreadCount === 1 ? 'ý' : unreadCount < 5 ? 'é' : 'ých'}</Text> : null}</Text>

        {loading && calls.length === 0 ? (
          <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
        ) : error ? (
          <Text style={styles.empty}>{error}</Text>
        ) : calls.length === 0 ? (
          <Text style={styles.empty}>Zatím žádné vzkazy.</Text>
        ) : (
          calls.map((c) => {
            const open = openId === c.id;
            const turns = turnsOf(c);
            const src = c.audio_play_url ? apiBase.replace(/\/+$/, '') + c.audio_play_url : null;
            const showFull = fullFor === c.id;
            return (
              <View key={c.id} style={[styles.msgCard, !c.read && styles.msgCardNew, c.read && !open && styles.msgCardRead, open && styles.msgCardOpen]} onLayout={(e) => { cardY.current[c.id] = e.nativeEvent.layout.y; }}>
                <TouchableOpacity onPress={() => toggleOpen(c)} activeOpacity={0.8}>
                  <View style={styles.rowBetween}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 }}>
                      {!c.read ? <View style={styles.newDot} /> : null}
                      <Text style={[styles.msgWho, c.read && styles.msgWhoRead]} numberOfLines={1}>{c.caller_name || c.from_number || 'Neznámý volající'}</Text>
                    </View>
                    {!c.read ? <Text style={styles.newPill}>NOVÉ</Text> : <Text style={styles.msgWhen}>{fmtWhen(c.started_at)}</Text>}
                  </View>
                  {!c.read ? <Text style={styles.msgWhenNew}>{fmtWhen(c.started_at)}</Text> : null}
                  <Text style={[styles.msgIntent, c.read && !open && styles.msgIntentRead]} numberOfLines={open ? undefined : 2}>{c.caller_intent || c.summary || '—'}</Text>
                  <Text style={styles.msgTag}>
                    {c.handoff ? '📞 Přepojeno' : '📩 Vzkaz'}
                    {c.duration_sec ? ' · ' + fmtDur(c.duration_sec) : ''}
                    {src ? ' · 🎧 nahrávka' : ''}
                    {c.read ? ' · ✓ přečteno' : ''}
                    {'  '}{open ? '▲' : '▼'}
                  </Text>
                </TouchableOpacity>

                {open && (
                  <View style={styles.detail}>
                    <TouchableOpacity onPress={() => { setRead(c.id, false); setOpenId(null); }} style={{ alignSelf: 'flex-end', marginBottom: spacing.sm }}>
                      <Text style={styles.link}>○ Označit jako nepřečtené</Text>
                    </TouchableOpacity>
                    {c.from_number ? (
                      <TouchableOpacity style={styles.callBack} onPress={() => Linking.openURL('tel:' + c.from_number)}>
                        <Text style={styles.callBackTxt}>📞 Zavolat zpět {c.from_number}</Text>
                      </TouchableOpacity>
                    ) : null}

                    {c.summary ? (
                      <View style={styles.summaryBox}>
                        <Text style={styles.label}>Shrnutí</Text>
                        <Text style={styles.summary}>{c.summary}</Text>
                      </View>
                    ) : null}

                    <Text style={styles.label}>Nahrávka</Text>
                    {src ? (
                      <View style={styles.audioWrap}>
                        <WebView
                          source={{ html: audioHtml(src), baseUrl: apiBase }}
                          style={styles.audio}
                          scrollEnabled={false}
                          originWhitelist={['*']}
                          allowsInlineMediaPlayback
                          mediaPlaybackRequiresUserAction
                        />
                      </View>
                    ) : <Text style={styles.noAudio}>Nahrávka zatím není k dispozici (dorazí do minuty po hovoru — stáhni dolů pro obnovení).</Text>}

                    <Text style={[styles.label, { marginTop: spacing.md }]}>Přepis hovoru</Text>
                    {turns.length ? (
                      <View style={{ gap: 6 }}>
                        {turns.map((t, i) => (
                          <View key={i} style={[styles.bubble, t.who === 'agent' ? styles.bubbleAgent : styles.bubbleCaller]}>
                            <Text style={styles.bubbleWho}>{t.who === 'agent' ? '🤖 Asistent' : '👤 Volající'}</Text>
                            <Text style={styles.bubbleTxt}>{t.text}</Text>
                          </View>
                        ))}
                      </View>
                    ) : <Text style={styles.noAudio}>Přepis není k dispozici.</Text>}

                    {c.full_transcript && c.full_transcript.trim() ? (
                      <View style={{ marginTop: spacing.md }}>
                        <TouchableOpacity onPress={() => setFullFor(showFull ? null : c.id)}>
                          <Text style={styles.link}>{showFull ? '▲ Skrýt přesný přepis nahrávky' : '▼ Přesný přepis z nahrávky'}</Text>
                        </TouchableOpacity>
                        {showFull ? <Text style={styles.transcript}>{c.full_transcript.trim()}</Text> : null}
                      </View>
                    ) : null}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { paddingVertical: spacing.xl, alignItems: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: 60 },
  h1: { color: colors.text, fontSize: 22, fontWeight: '700' },
  back: { alignSelf: 'flex-start', paddingVertical: 6, paddingRight: 12, marginBottom: 4 },
  backTxt: { color: colors.accent2, fontSize: 17, fontWeight: '600' },
  sub: { color: colors.text2, fontSize: 13, marginTop: 2, marginBottom: spacing.md },
  empty: { color: colors.text2, fontSize: 14, textAlign: 'center', paddingVertical: spacing.lg },
  msgCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  msgCardOpen: { borderColor: colors.accent, opacity: 1 },
  msgCardNew: { borderColor: '#4fd1ff', borderLeftWidth: 4, backgroundColor: 'rgba(79,209,255,0.07)' },
  msgCardRead: { opacity: 0.6 },
  newDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#4fd1ff' },
  newPill: { color: '#04060c', backgroundColor: '#4fd1ff', fontSize: 10.5, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden', letterSpacing: 0.6 },
  msgWhoRead: { fontWeight: '500', color: colors.text2 },
  msgWhenNew: { color: '#4fd1ff', fontSize: 12, marginTop: 2 },
  msgIntentRead: { color: colors.text2 },
  subNew: { color: '#4fd1ff', fontWeight: '700' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  msgWho: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  msgWhen: { color: colors.text2, fontSize: 12 },
  msgIntent: { color: colors.text, fontSize: 14, marginTop: 4, lineHeight: 20 },
  msgTag: { color: colors.text2, fontSize: 12, marginTop: 6 },
  detail: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  callBack: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center', marginBottom: spacing.md },
  callBackTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  summaryBox: { backgroundColor: colors.bg, borderRadius: radius.md, padding: spacing.sm, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  summary: { color: colors.text, fontSize: 14, lineHeight: 20 },
  label: { color: colors.text2, fontSize: 11.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  audioWrap: { height: 56, borderRadius: radius.md, overflow: 'hidden' },
  audio: { flex: 1, backgroundColor: 'transparent' },
  noAudio: { color: colors.text2, fontSize: 12.5, marginBottom: spacing.sm },
  bubble: { borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 10, maxWidth: '92%' },
  bubbleAgent: { alignSelf: 'flex-start', backgroundColor: 'rgba(120,160,255,0.12)', borderWidth: 1, borderColor: colors.border },
  bubbleCaller: { alignSelf: 'flex-end', backgroundColor: 'rgba(34,197,94,0.14)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.35)' },
  bubbleWho: { color: colors.text2, fontSize: 11, marginBottom: 2 },
  bubbleTxt: { color: colors.text, fontSize: 14, lineHeight: 20 },
  link: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  transcript: { color: colors.text, fontSize: 13.5, lineHeight: 20, marginTop: 6 },
});
