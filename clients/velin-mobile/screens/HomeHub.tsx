// =============================================================================
// HomeHub — „Moderní HOME" Velína: rozcestník pod-aplikací (dlaždice)
// =============================================================================
// Prázdná domovská plocha, na kterou se postupně přidávají jednotlivé sekce Velína
// jako aplikace (dlaždice). Novou aplikaci přidáš do pole APPS níže:
//   { key, title, subtitle, icon, color, screen, params? }  → screen = název obrazovky ve Stacku.

import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { loadAuth } from '../lib/auth';
import { api } from '../lib/api';
import { colors, spacing } from '../lib/theme';

type HubApp = {
  key: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string; // barva dlaždice (pozadí ikony + jemný nádech karty)
  screen: string;
  params?: any;
};

// ── Seznam aplikací na HOME (pořadí = pořadí na ploše) ──
const APPS: HubApp[] = [
  { key: 'assistant', title: 'Vzkazy z hovorů', subtitle: 'AI asistent · nahrávky a přepisy', icon: '📞', color: '#6366f1', screen: 'AssistantSettings' },
];

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'Dobrou noc' : h < 10 ? 'Dobré ráno' : h < 18 ? 'Dobrý den' : 'Dobrý večer';
}

export default function HomeHub() {
  const navigation = useNavigation<any>();
  const [name, setName] = useState<string>('');
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const auth = await loadAuth();
      setName(String((auth as any).displayName || '').split(' ')[0] || '');
      if (!auth.jwt) return;
      // Odznak u „Vzkazy z hovorů" = počet vzkazů za posledních 24 h
      try {
        const r = await api.myAssistantCalls(auth.jwt);
        const since = Date.now() - 24 * 3600 * 1000;
        const n = (r.calls || []).filter((c) => new Date(c.started_at).getTime() >= since).length;
        setBadges((b) => ({ ...b, assistant: n }));
      } catch (_) { /* bez odznaku */ }
    } catch (_) { /* nic */ }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
      <Text style={styles.hello}>{greeting()}{name ? ', ' + name : ''}</Text>
      <Text style={styles.sub}>Tvoje aplikace ve Velínu</Text>

      <View style={styles.grid}>
        {APPS.map((a) => {
          const n = badges[a.key] || 0;
          return (
            <TouchableOpacity
              key={a.key}
              activeOpacity={0.85}
              style={[styles.tile, { borderColor: a.color + '66', backgroundColor: a.color + '1f' }]}
              onPress={() => navigation.navigate(a.screen, a.params)}
            >
              <View style={[styles.iconWrap, { backgroundColor: a.color }]}>
                <Text style={styles.icon}>{a.icon}</Text>
              </View>
              {n > 0 ? (
                <View style={styles.badge}><Text style={styles.badgeTxt}>{n > 99 ? '99+' : n}</Text></View>
              ) : null}
              <Text style={styles.tileTitle} numberOfLines={2}>{a.title}</Text>
              <Text style={styles.tileSub} numberOfLines={2}>{a.subtitle}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: 60 },
  hello: { color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.3 },
  sub: { color: colors.text2, fontSize: 14, marginTop: 4, marginBottom: spacing.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },
  tile: {
    width: '48%', minHeight: 150, borderRadius: 22, borderWidth: 1, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4,
  },
  iconWrap: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  icon: { fontSize: 26 },
  badge: { position: 'absolute', top: 12, right: 12, minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  badgeTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },
  tileTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  tileSub: { color: colors.text2, fontSize: 12, marginTop: 4, lineHeight: 16 },
});
