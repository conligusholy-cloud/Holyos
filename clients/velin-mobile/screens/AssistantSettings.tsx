// =============================================================================
// AssistantSettings — osobní AI asistent: nastavení + vzkazy (přehrát + přečíst)
// =============================================================================
// Kompletní nastavení jako v HolyOS (číslo, hlas, uvítání, instrukce, přepojení)
// + seznam vzkazů/hovorů s přehráním nahrávky (WebView <audio>) a přepisem.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { loadAuth } from '../lib/auth';
import { api, MyAssistantConfig, AssistantCall } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('cs-CZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function AssistantSettings() {
  const [jwt, setJwt] = useState<string | null>(null);
  const [cfg, setCfg] = useState<MyAssistantConfig | null>(null);
  const [calls, setCalls] = useState<AssistantCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const auth = await loadAuth();
      setJwt(auth.jwt);
      if (!auth.jwt) return;
      const [c, cl] = await Promise.all([
        api.myAssistant(auth.jwt),
        api.myAssistantCalls(auth.jwt).catch(() => ({ calls: [] as AssistantCall[] })),
      ]);
      setCfg({
        enabled: !!c.enabled, number: c.number || '',
        inbound_greeting: c.inbound_greeting || '', inbound_prompt: c.inbound_prompt || '',
        transfer_enabled: !!c.transfer_enabled, transfer_number: c.transfer_number || '',
        tts_voice: c.tts_voice === 'male' ? 'male' : 'female',
      });
      setCalls(Array.isArray(cl.calls) ? cl.calls : []);
    } catch (e: any) {
      setMsg(e?.message || 'Načtení selhalo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function set<K extends keyof MyAssistantConfig>(k: K, v: MyAssistantConfig[K]) {
    setCfg((p) => (p ? { ...p, [k]: v } : p));
  }

  async function save() {
    if (!jwt || !cfg) return;
    if (cfg.enabled && !cfg.number.trim()) { setMsg('Zadej Twilio číslo asistenta.'); return; }
    if (cfg.transfer_enabled && !cfg.transfer_number.trim()) { setMsg('Zapnul jsi přepojení — zadej číslo.'); return; }
    setSaving(true); setMsg('Ukládám…');
    try {
      await api.saveMyAssistant(jwt, cfg);
      setMsg('✓ Uloženo');
    } catch (e: any) {
      setMsg('Chyba: ' + (e?.message || 'uložení selhalo'));
    } finally {
      setSaving(false);
    }
  }

  function transcriptText(c: AssistantCall): string {
    if (c.full_transcript && c.full_transcript.trim()) return c.full_transcript.trim();
    if (Array.isArray(c.transcript) && c.transcript.length) {
      return c.transcript.map((t) => (t.role === 'agent' ? 'Asistent: ' : 'Volající: ') + (t.text || '')).join('\n');
    }
    return 'Přepis není k dispozici.';
  }

  if (loading) {
    return <SafeAreaView style={styles.container} edges={['top']}><View style={styles.center}><ActivityIndicator color={colors.accent} /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.accent} />}>
        <Text style={styles.h1}>📞 Osobní asistent</Text>

        {cfg && (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.label}>Služba zapnutá</Text>
              <Switch value={cfg.enabled} onValueChange={(v) => set('enabled', v)} />
            </View>

            <Text style={styles.fieldLabel}>Twilio číslo asistenta</Text>
            <TextInput style={styles.input} value={cfg.number} onChangeText={(v) => set('number', v)} placeholder="+420…" placeholderTextColor={colors.text2} keyboardType="phone-pad" />

            <Text style={styles.fieldLabel}>Hlas asistenta</Text>
            <View style={styles.segRow}>
              {(['female', 'male'] as const).map((g) => (
                <TouchableOpacity key={g} style={[styles.seg, cfg.tts_voice === g && styles.segOn]} onPress={() => set('tts_voice', g)}>
                  <Text style={[styles.segText, cfg.tts_voice === g && styles.segTextOn]}>{g === 'female' ? '👩 Ženský' : '👨 Mužský'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Uvítání (co AI řekne na začátku)</Text>
            <TextInput style={[styles.input, styles.area]} value={cfg.inbound_greeting} onChangeText={(v) => set('inbound_greeting', v)} multiline placeholder="Dobrý den, dovolali jste se…" placeholderTextColor={colors.text2} />

            <Text style={styles.fieldLabel}>Instrukce pro AI (nepovinné)</Text>
            <TextInput style={[styles.input, styles.area]} value={cfg.inbound_prompt} onChangeText={(v) => set('inbound_prompt', v)} multiline placeholder="Zjisti jméno, telefon a důvod hovoru…" placeholderTextColor={colors.text2} />

            <View style={styles.rowBetween}>
              <Text style={styles.label}>Nejdřív zkusit přepojit na mé číslo</Text>
              <Switch value={cfg.transfer_enabled} onValueChange={(v) => set('transfer_enabled', v)} />
            </View>
            {cfg.transfer_enabled && (
              <TextInput style={styles.input} value={cfg.transfer_number} onChangeText={(v) => set('transfer_number', v)} placeholder="+420… (tvůj telefon)" placeholderTextColor={colors.text2} keyboardType="phone-pad" />
            )}

            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
              <Text style={styles.saveText}>{saving ? 'Ukládám…' : 'Uložit'}</Text>
            </TouchableOpacity>
            {msg ? <Text style={styles.msg}>{msg}</Text> : null}
          </View>
        )}

        <Text style={styles.h2}>📩 Vzkazy asistenta</Text>
        {calls.length === 0 ? (
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: 60 },
  h1: { color: colors.text, fontSize: 22, fontWeight: '700', marginBottom: spacing.md },
  h2: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: spacing.xl, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginVertical: spacing.sm },
  label: { color: colors.text, fontSize: 14, flexShrink: 1 },
  fieldLabel: { color: colors.text2, fontSize: 12, marginTop: spacing.md, marginBottom: 4 },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, fontSize: 15 },
  area: { minHeight: 70, textAlignVertical: 'top' },
  segRow: { flexDirection: 'row', gap: spacing.sm },
  seg: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', backgroundColor: colors.bg },
  segOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  segText: { color: colors.text2, fontSize: 14 },
  segTextOn: { color: '#fff', fontWeight: '700' },
  saveBtn: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.lg },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  msg: { color: colors.text2, fontSize: 13, textAlign: 'center', marginTop: spacing.sm },
  empty: { color: colors.text2, fontSize: 14, textAlign: 'center', paddingVertical: spacing.lg },
  msgCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
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
