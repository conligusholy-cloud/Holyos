// =============================================================================
// Me — profil a odhlášení
// =============================================================================

import React, { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CommonActions, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { loadAuth, clearAuth, AuthSnapshot } from '../lib/auth';
import { API_BASE, api, MyAssistantConfig } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';
import type { RootStackParamList } from '../App';
import Constants from 'expo-constants';

export default function Me() {
  const [auth, setAuth] = useState<AuthSnapshot | null>(null);
  const [jwt, setJwt] = useState<string | null>(null);
  const [assistant, setAssistant] = useState<MyAssistantConfig | null>(null);
  const [paSaving, setPaSaving] = useState(false);
  const [paMsg, setPaMsg] = useState<string | null>(null);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const appVersion = Constants.expoConfig?.version || '0.1.0';

  useEffect(() => {
    loadAuth().then((a) => {
      setAuth(a);
      setJwt(a?.jwt || null);
      if (a?.jwt) {
        api.myAssistant(a.jwt)
          .then((r) => setAssistant({
            enabled: !!r.enabled, number: r.number || '',
            inbound_greeting: r.inbound_greeting || '', inbound_prompt: r.inbound_prompt || '',
            transfer_enabled: !!r.transfer_enabled, transfer_number: r.transfer_number || '',
            tts_voice: r.tts_voice === 'male' ? 'male' : 'female',
          }))
          .catch(() => setAssistant(null));
      }
    });
  }, []);

  function setPa<K extends keyof MyAssistantConfig>(k: K, v: MyAssistantConfig[K]) {
    setAssistant((p) => (p ? { ...p, [k]: v } : p));
  }
  async function savePa() {
    if (!jwt || !assistant) return;
    if (assistant.enabled && !assistant.number.trim()) { setPaMsg('Zadej Twilio číslo asistenta.'); return; }
    if (assistant.transfer_enabled && !assistant.transfer_number.trim()) { setPaMsg('Zapnul jsi přepojení — zadej číslo.'); return; }
    setPaSaving(true); setPaMsg('Ukládám…');
    try { await api.saveMyAssistant(jwt, assistant); setPaMsg('✓ Uloženo'); }
    catch (e: any) { setPaMsg('Chyba: ' + (e?.message || 'uložení selhalo')); }
    finally { setPaSaving(false); }
  }

  // GSM kód pro podmíněné přesměrování — otevře volání (appka to nezvládne potichu).
  function dialForward(prefix: string) {
    const num = assistant?.number || '';
    if (!num) return;
    const code = `${prefix}*${num}#`;
    Linking.openURL('tel:' + code.replace(/#/g, '%23')).catch(() =>
      Alert.alert('Nelze otevřít volání', 'Zadej kód ručně: ' + code)
    );
  }
  function cancelForward() {
    Linking.openURL('tel:' + '##002%23').catch(() =>
      Alert.alert('Nelze otevřít volání', 'Zadej ručně: ##002#')
    );
  }

  function confirmLogout() {
    Alert.alert(
      'Odhlásit se',
      'Po odhlášení budeš muset zadat HolyOS heslo znovu. Notifikace ti přestanou chodit, dokud se znovu nepřihlásíš.',
      [
        { text: 'Zrušit', style: 'cancel' },
        {
          text: 'Odhlásit',
          style: 'destructive',
          onPress: async () => {
            await clearAuth();
            navigation.dispatch(
              CommonActions.reset({ index: 0, routes: [{ name: 'Login' as never }] })
            );
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(auth?.displayName || auth?.username || '?').slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.name}>{auth?.displayName || '—'}</Text>
        <Text style={styles.username}>@{auth?.username || '—'}</Text>

        <View style={styles.card}>
          <Row label="Person ID" value={auth?.personId ? String(auth.personId) : '—'} />
          <Row label="HolyOS" value={API_BASE} />
          <Row label="Verze aplikace" value={appVersion} />
        </View>

        {assistant && (
          <View style={styles.paCard}>
            <Text style={styles.paTitle}>📞 Osobní asistent</Text>
            <Text style={styles.paHint}>AI zvedne nezvednuté hovory, zjistí kdo volá a co potřebuje, a založí ti vzkaz.</Text>

            <View style={styles.paRow}>
              <Text style={styles.paLabel}>Služba zapnutá</Text>
              <Switch value={assistant.enabled} onValueChange={(v) => setPa('enabled', v)} />
            </View>

            <Text style={styles.paFieldLabel}>Twilio číslo asistenta</Text>
            <TextInput style={styles.paInput} value={assistant.number} onChangeText={(v) => setPa('number', v)} placeholder="+420…" placeholderTextColor={colors.text2} keyboardType="phone-pad" />

            <Text style={styles.paFieldLabel}>Hlas asistenta</Text>
            <View style={styles.paSeg}>
              {(['female', 'male'] as const).map((g) => (
                <TouchableOpacity key={g} style={[styles.paSegItem, assistant.tts_voice === g && styles.paSegOn]} onPress={() => setPa('tts_voice', g)}>
                  <Text style={[styles.paSegText, assistant.tts_voice === g && styles.paSegTextOn]}>{g === 'female' ? '👩 Ženský' : '👨 Mužský'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.paFieldLabel}>Uvítání (co AI řekne na začátku)</Text>
            <TextInput style={[styles.paInput, styles.paArea]} value={assistant.inbound_greeting} onChangeText={(v) => setPa('inbound_greeting', v)} multiline placeholder="Dobrý den, dovolali jste se…" placeholderTextColor={colors.text2} />

            <Text style={styles.paFieldLabel}>Instrukce pro AI (nepovinné)</Text>
            <TextInput style={[styles.paInput, styles.paArea]} value={assistant.inbound_prompt} onChangeText={(v) => setPa('inbound_prompt', v)} multiline placeholder="Zjisti jméno, telefon a důvod hovoru…" placeholderTextColor={colors.text2} />

            <View style={styles.paRow}>
              <Text style={styles.paLabel}>Nejdřív zkusit přepojit na mé číslo</Text>
              <Switch value={assistant.transfer_enabled} onValueChange={(v) => setPa('transfer_enabled', v)} />
            </View>
            {assistant.transfer_enabled && (
              <TextInput style={styles.paInput} value={assistant.transfer_number} onChangeText={(v) => setPa('transfer_number', v)} placeholder="+420… (tvůj telefon)" placeholderTextColor={colors.text2} keyboardType="phone-pad" />
            )}

            <TouchableOpacity style={[styles.paSaveBtn, paSaving && { opacity: 0.6 }]} onPress={savePa} disabled={paSaving}>
              <Text style={styles.paSaveText}>{paSaving ? 'Ukládám…' : 'Uložit'}</Text>
            </TouchableOpacity>
            {paMsg ? <Text style={styles.paMsg}>{paMsg}</Text> : null}

            {assistant.number ? (
              <>
                <Text style={[styles.paFieldLabel, { marginTop: spacing.lg }]}>Přesměrování na telefonu (u operátora)</Text>
                <TouchableOpacity style={styles.paBtn} onPress={() => dialForward('**61')}><Text style={styles.paBtnText}>Zapnout — když neberu</Text></TouchableOpacity>
                <TouchableOpacity style={styles.paBtn} onPress={() => dialForward('**67')}><Text style={styles.paBtnText}>Zapnout — když mám obsazeno</Text></TouchableOpacity>
                <TouchableOpacity style={styles.paBtn} onPress={() => dialForward('**62')}><Text style={styles.paBtnText}>Zapnout — když jsem nedostupný</Text></TouchableOpacity>
                <TouchableOpacity style={styles.paCancelBtn} onPress={cancelForward}><Text style={styles.paCancelText}>Zrušit přesměrování</Text></TouchableOpacity>
              </>
            ) : null}

            <TouchableOpacity style={styles.paSettingsBtn} onPress={() => navigation.navigate('AssistantSettings')}>
              <Text style={styles.paSettingsText}>📩  Vzkazy asistenta</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={styles.reflectionBtn}
          onPress={() => navigation.navigate('Attendance')}
        >
          <Text style={styles.reflectionBtnText}>⏱  Docházka</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.reflectionBtn, { marginTop: spacing.md }]}
          onPress={() => navigation.navigate('EveningReflection')}
        >
          <Text style={styles.reflectionBtnText}>🌙  Dnešní reflexe</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutBtn} onPress={confirmLogout}>
          <Text style={styles.logoutText}>Odhlásit se</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>Velín · Best Series s.r.o.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.xl, paddingBottom: 60, alignItems: 'center' },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    marginTop: spacing.lg,
  },
  avatarText: { color: '#fff', fontSize: 28, fontWeight: '700' },
  name: { color: colors.text, fontSize: 20, fontWeight: '600' },
  username: { color: colors.text2, fontSize: 13, marginTop: 2 },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    gap: spacing.md,
  },
  rowLabel: { color: colors.text2, fontSize: 13 },
  rowValue: { color: colors.text, fontSize: 13, flexShrink: 1, textAlign: 'right' },
  paCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  paTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  paSub: { color: colors.text2, fontSize: 13, marginTop: 2 },
  paHint: { color: colors.text2, fontSize: 12, marginTop: spacing.sm, lineHeight: 17 },
  paBtn: {
    backgroundColor: 'rgba(99,102,241,0.15)',
    borderColor: 'rgba(99,102,241,0.35)',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    alignItems: 'center',
  },
  paBtnText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  paCancelBtn: {
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    alignItems: 'center',
  },
  paCancelText: { color: colors.danger, fontWeight: '600', fontSize: 13 },
  paSettingsBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  paSettingsText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  paRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginTop: spacing.md },
  paLabel: { color: colors.text, fontSize: 14, flexShrink: 1 },
  paFieldLabel: { color: colors.text2, fontSize: 12, marginTop: spacing.md, marginBottom: 4 },
  paInput: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, fontSize: 15 },
  paArea: { minHeight: 66, textAlignVertical: 'top' },
  paSeg: { flexDirection: 'row', gap: spacing.sm },
  paSegItem: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: 'center', backgroundColor: colors.bg },
  paSegOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  paSegText: { color: colors.text2, fontSize: 14 },
  paSegTextOn: { color: '#fff', fontWeight: '700' },
  paSaveBtn: { backgroundColor: colors.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.lg },
  paSaveText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  paMsg: { color: colors.text2, fontSize: 13, textAlign: 'center', marginTop: spacing.sm },
  reflectionBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xxl,
    alignItems: 'center',
    width: '100%',
  },
  reflectionBtnText: { color: '#0b1220', fontWeight: '700', fontSize: 15 },
  logoutBtn: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderColor: 'rgba(239,68,68,0.3)',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
  logoutText: { color: colors.danger, fontWeight: '600', fontSize: 15 },
  footer: { color: colors.text2, fontSize: 11, marginTop: spacing.xxl },
});
