// =============================================================================
// SupportSound — nastavení zvuku notifikace Podpory (10 zvuků + výchozí)
// =============================================================================
// Klepnutí na zvuk ho vybere, uloží na server (platí pro push z BS2) a přehraje ukázku.
// Zvuky jsou zabalené v aplikaci → fungují od verze aplikace, která je obsahuje.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import { loadAuth } from '../lib/auth';
import { SUPPORT_SOUNDS, previewSupportSound } from '../lib/push';
import { colors, radius, spacing } from '../lib/theme';

export default function SupportSound() {
  const [sound, setSound] = useState<string>('default');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const auth = await loadAuth();
        if (auth.jwt) setSound((await api.supportSoundGet(auth.jwt)).sound || 'default');
      } catch { /* necháme výchozí */ }
      setLoading(false);
    })();
  }, []);

  async function choose(id: string) {
    if (saving) return;
    setSound(id);
    setSaving(true);
    try {
      await previewSupportSound(id).catch(() => {});
      const auth = await loadAuth();
      if (auth.jwt) await api.supportSoundSet(auth.jwt, id);
    } catch (err) {
      Alert.alert('Zvuk se nepodařilo uložit', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const items = [{ id: 'default', label: 'Výchozí zvuk telefonu' }, ...SUPPORT_SOUNDS];

  if (loading) {
    return <SafeAreaView style={styles.center} edges={['top']}><ActivityIndicator size="large" color={colors.accent} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        <Text style={styles.title}>Zvuk notifikace Podpory</Text>
        <Text style={styles.note}>
          Klepni na zvuk — uloží se a přehraje se ukázka. Zvuk uslyšíš u nových zpráv zákazníků.
          Ukázku neuslyšíš, když máš telefon v tichém režimu.
        </Text>
        {items.map((s) => {
          const on = sound === s.id;
          return (
            <TouchableOpacity key={s.id} style={[styles.row, on && styles.rowOn]} activeOpacity={0.7} onPress={() => choose(s.id)}>
              <Text style={styles.icon}>{s.id === 'default' ? '🔔' : '🎵'}</Text>
              <Text style={[styles.label, on && styles.labelOn]}>{s.label}</Text>
              {on ? <Text style={styles.check}>✓</Text> : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: spacing.sm },
  note: { color: colors.text2, fontSize: 13, marginBottom: spacing.lg, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, backgroundColor: colors.surface },
  rowOn: { borderColor: colors.accent, backgroundColor: colors.surface2 },
  icon: { fontSize: 20, marginRight: spacing.md },
  label: { color: colors.text, fontSize: 16, flex: 1 },
  labelOn: { fontWeight: '700' },
  check: { color: colors.accent, fontSize: 20, fontWeight: '800' },
});
