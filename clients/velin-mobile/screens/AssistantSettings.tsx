// =============================================================================
// AssistantSettings — vzkazy osobního asistenta (přehrát + přečíst)
// =============================================================================
// Nastavení asistenta je v sekci „Já". Tady je seznam vzkazů/hovorů s přehráním
// nahrávky (WebView <audio>) a rozbalovacím přepisem.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { loadAuth } from '../lib/auth';
import { api, AssistantCall } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('cs-CZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function AssistantSettings() {
  const [calls, setCalls] = useState<AssistantCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

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

  function transcriptText(c: AssistantCall): string {
    if (c.full_transcript && c.full_transcript.trim()) return c.full_transcript.trim();
    if (Array.isArray(c.transcript) && c.transcript.length) {
      return c.transcript.map((t) => (t.role === 'agent' ? 'Asistent: ' : 'Volající: ') + (t.text || '')).join('\n');
    }
    return 'Přepis není k dispozici.';
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}>
        <Text style={styles.h1}>📩 Vzkazy asistenta</Text>

        {loading && calls.length === 0 ? (
          <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
        ) : error ? (
          <Text style={styles.empty}>{error}</Text>
        ) : calls.length === 0 ? (
          <Text style={styles.empty}>Zatím žádné vzkazy.</Text>
        ) : (
          calls.map((c) => {
            const open = openId === c.id;
            return (
              <View key={c.id} style={styles.msgCard}>
                <TouchableOpacity onPress={() => setOpenId(open ? null : c.id)}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.msgWho}>{c.caller_name || c.from_number || 'Neznámý'}</Text>
                    <Text style={styles.msgWhen}>{fmtWhen(c.started_at)}</Text>
                  </View>
                  <Text style={styles.msgIntent}>{c.caller_intent || c.summary || '—'}</Text>
                  <Text style={styles.msgTag}>{c.handoff ? '📞 Přepojeno' : '📩 Vzkaz'}{c.from_number ? ' · ' + c.from_number : ''}</Text>
                </TouchableOpacity>
                {open && (
                  <View style={styles.detail}>
                    {c.audio_url ? (
                      <View style={styles.audioWrap}>
                        <WebView
                          source={{ html: `<body style="margin:0;background:transparent"><audio controls preload="none" style="width:100%" src="${c.audio_url}"></audio></body>` }}
                          style={styles.audio}
                          scrollEnabled={false}
                        />
                      </View>
                    ) : <Text style={styles.noAudio}>Nahrávka není k dispozici.</Text>}
                    <Text style={styles.transcript}>{transcriptText(c)}</Text>
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
  h1: { color: colors.text, fontSize: 22, fontWeight: '700', marginBottom: spacing.md },
  empty: { color: colors.text2, fontSize: 14, textAlign: 'center', paddingVertical: spacing.lg },
  msgCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  msgWho: { color: colors.text, fontSize: 15, fontWeight: '700' },
  msgWhen: { color: colors.text2, fontSize: 12 },
  msgIntent: { color: colors.text, fontSize: 14, marginTop: 4 },
  msgTag: { color: colors.text2, fontSize: 12, marginTop: 4 },
  detail: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  audioWrap: { height: 54, marginBottom: spacing.sm },
  audio: { flex: 1, backgroundColor: 'transparent' },
  noAudio: { color: colors.text2, fontSize: 12, marginBottom: spacing.sm },
  transcript: { color: colors.text, fontSize: 13.5, lineHeight: 20 },
});
