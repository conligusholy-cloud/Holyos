// =============================================================================
// HomeHub — „Moderní HOME" Velína: plocha s ikonami pod-aplikací (styl Best Series 2.0)
// =============================================================================
// Domovská plocha jako na telefonu: malé ikony aplikací v mřížce (4 v řadě) s popiskem.
// Vizuál = Best Series 2.0 (tmavé pozadí #04060c, azurová #4fd1ff, modrá #1e86e0, fialová #7c5cff).
// Novou aplikaci přidáš do pole APPS: { key, title, icon, tint, screen, params? }.

import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { loadAuth } from '../lib/auth';
import { api } from '../lib/api';

// Paleta Best Series 2.0 (shodná s webem bestseries2.cz)
const BS = {
  bg: '#04060c',
  card: 'rgba(14,22,40,0.72)',
  border: 'rgba(120,160,255,0.14)',
  border2: 'rgba(120,160,255,0.28)',
  text: '#eaf2ff',
  text2: '#8ea2c2',
  text3: '#58698a',
  accent: '#1e86e0',
  accent2: '#4fd1ff',
  vio: '#7c5cff',
  err: '#ff5d6c',
};

type HubApp = { key: string; title: string; icon: string; tint: string; screen: string; params?: any };

// ── Aplikace na ploše (pořadí = pořadí v mřížce) ──
const APPS: HubApp[] = [
  { key: 'assistant', title: 'Vzkazy', icon: '📞', tint: BS.accent, screen: 'AssistantSettings' },
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
      // Odznak u „Vzkazy" = počet nepřečtených vzkazů
      try {
        const r = await api.myAssistantCalls(auth.jwt);
        const n = typeof r.unread === 'number' ? r.unread : (r.calls || []).filter((c) => !c.read).length; // nepřečtené vzkazy
        setBadges((b) => ({ ...b, assistant: n }));
      } catch (_) { /* bez odznaku */ }
    } catch (_) { /* nic */ }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <View style={styles.root}>

      <ScrollView contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BS.accent2} />}>
        <View style={styles.brandRow}>
          <Text style={styles.brand}>BEST SERIES <Text style={styles.brandV}>2.0</Text></Text>
          <View style={styles.tag}><Text style={styles.tagTxt}>VELÍN</Text></View>
        </View>
        <Text style={styles.hello}>{greeting()}{name ? ', ' : ''}<Text style={styles.helloName}>{name}</Text></Text>
        <View style={styles.line} />

        <View style={styles.grid}>
          {APPS.map((a) => {
            const n = badges[a.key] || 0;
            return (
              <TouchableOpacity key={a.key} activeOpacity={0.75} style={styles.app} onPress={() => navigation.navigate(a.screen, a.params)}>
                <View style={[styles.icon, { backgroundColor: a.tint + '33', borderColor: a.tint + '88', shadowColor: a.tint }]}>
                  <Text style={styles.iconTxt}>{a.icon}</Text>
                  {n > 0 ? <View style={styles.badge}><Text style={styles.badgeTxt}>{n > 99 ? '99+' : n}</Text></View> : null}
                </View>
                <Text style={styles.label} numberOfLines={1}>{a.title}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BS.bg, overflow: 'hidden' },
  scroll: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 60 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: BS.text, fontSize: 15, fontWeight: '900', letterSpacing: 1.2 },
  brandV: { color: BS.accent2 },
  tag: { borderWidth: 1, borderColor: BS.border2, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, backgroundColor: 'rgba(255,255,255,0.02)' },
  tagTxt: { color: BS.text2, fontSize: 10, fontWeight: '700', letterSpacing: 1.6 },
  hello: { color: BS.text, fontSize: 22, fontWeight: '800', marginTop: 14, letterSpacing: -0.3 },
  helloName: { color: BS.accent2 },
  line: { height: 2, width: 56, borderRadius: 1, backgroundColor: BS.accent2, marginTop: 10, marginBottom: 26, opacity: 0.8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  app: { width: '25%', alignItems: 'center', marginBottom: 22 },
  icon: {
    width: 60, height: 60, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
    shadowOpacity: 0.55, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 6,
  },
  iconTxt: { fontSize: 27 },
  badge: { position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: BS.err, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: BS.bg },
  badgeTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },
  label: { color: BS.text, fontSize: 12, fontWeight: '600', marginTop: 7 },
});
