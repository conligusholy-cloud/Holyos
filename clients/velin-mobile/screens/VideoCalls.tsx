// =============================================================================
// VideoCalls — aplikace „Videohovory“: žádosti o videohovor z laundromats.eu (posledních 24 h)
// =============================================================================
// Zdroj = notifikace HolyOS s odkazem /videocall/agent/… (stejné, jaké přijdou pushem).
// Klepnutím se hovor otevře přímo ve Velínu (obrazovka VideoCall).

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { api, AppNotification } from '../lib/api';
import { loadAuth } from '../lib/auth';
import { VC_URL_RE } from './VideoCall';

const BS = { bg: '#04060c', card: '#0b1220', border: 'rgba(120,160,255,.18)', text: '#eaf2ff', text2: '#8ea2c2', accent2: '#4fd1ff', ok: '#2fe3a0' };

export default function VideoCalls() {
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const a = await loadAuth(); if (!a.jwt) throw new Error('Chybí přihlášení.');
      const rows = await api.notifications(a.jwt, 100);
      const lim = Date.now() - 24 * 3600e3;
      setItems((Array.isArray(rows) ? rows : []).filter((n) => !!n.link && VC_URL_RE.test(n.link) && new Date(n.created_at).getTime() > lim));
    } catch (e: any) { setErr(e?.message || 'Nepodařilo se načíst.'); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]));

  const when = (d: string) => { const t = new Date(d); const min = Math.round((Date.now() - t.getTime()) / 60000); return min < 1 ? 'právě teď' : min < 60 ? 'před ' + min + ' min' : t.toLocaleString('cs-CZ', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' }); };
  if (items === null && !err) return <View style={s.root}><ActivityIndicator color={BS.accent2} style={{ marginTop: 40 }} /></View>;
  return (
    <View style={s.root}>
      {err ? <Text style={s.err}>{err}</Text> : null}
      <FlatList
        data={items || []}
        keyExtractor={(n) => String(n.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={BS.accent2} />}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListHeaderComponent={<Text style={s.hint}>Zákazníci z laundromats.eu/videocall, kteří s vámi chtějí mluvit. Klepnutím se připojíte s kamerou.</Text>}
        ListEmptyComponent={<Text style={s.empty}>Za posledních 24 hodin nikdo nevolal.</Text>}
        renderItem={({ item }) => {
          const fresh = Date.now() - new Date(item.created_at).getTime() < 20 * 60000;
          return (
            <TouchableOpacity activeOpacity={0.8} style={[s.card, fresh && s.fresh]} onPress={() => navigation.navigate('VideoCall', { url: item.link })}>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>{(item.body || 'Zákazník').split(' s vámi')[0]}</Text>
                <Text style={s.body} numberOfLines={2}>{item.body}</Text>
                <Text style={s.when}>{when(item.created_at)}</Text>
              </View>
              <View style={[s.join, !fresh && { opacity: 0.6 }]}><Text style={s.joinTxt}>🎥 Připojit</Text></View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BS.bg },
  hint: { color: BS.text2, fontSize: 13.5, marginBottom: 4 },
  empty: { color: BS.text2, textAlign: 'center', marginTop: 30 },
  err: { color: '#ff8f8f', padding: 16 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: BS.card, borderWidth: 1, borderColor: BS.border, borderRadius: 16, padding: 14 },
  fresh: { borderColor: 'rgba(47,227,160,.55)' },
  title: { color: BS.text, fontSize: 16, fontWeight: '800' },
  body: { color: BS.text2, fontSize: 13, marginTop: 2 },
  when: { color: BS.accent2, fontSize: 12, marginTop: 6 },
  join: { backgroundColor: '#1e86e0', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  joinTxt: { color: '#fff', fontWeight: '800' },
});
