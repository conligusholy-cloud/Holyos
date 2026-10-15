// =============================================================================
// SupportList — živá podpora Best Series 2.0 (jen Tomáš a Jan Holý)
// =============================================================================
// GET /api/velin/support/threads → vlákna zákazníků s počtem nepřečtených.
// Přepínač Online/Offline určuje, zda uživatelé BS2 mohou psát do chatu.
// Seznam se obnovuje každých 8 s, dokud je obrazovka vidět.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api, ApiError, type SupportThread } from '../lib/api';
import { loadAuth, clearAuth } from '../lib/auth';
import { colors, radius, spacing } from '../lib/theme';
import type { RootStackParamList } from '../App';

export function supportName(t: { nick?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null }): string {
  const full = [t.first_name, t.last_name].filter(Boolean).join(' ').trim();
  return full || t.nick || t.email || 'Uživatel';
}

function initials(name: string): string {
  const p = name.split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] || '?') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' }) + ' ' +
    d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

export default function SupportList() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [online, setOnline] = useState(false);
  const [agent, setAgent] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread' | 'waiting' | 'online'>('all');
  const [toggling, setToggling] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async () => {
    const auth = await loadAuth();
    if (!auth.jwt) {
      await clearAuth();
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      return;
    }
    try {
      const r = await api.supportThreads(auth.jwt);
      if (!mounted.current) return;
      setThreads(r.threads);
      setOnline(r.online);
      setAgent(r.agent || '');
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof ApiError && err.status === 401) {
        await clearAuth();
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        return;
      }
      setError(err instanceof ApiError && err.status === 0 ? 'Server neodpovídá.' : (err as Error).message || 'Nepodařilo se načíst podporu.');
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
  }, [navigation]);

  // Při zobrazení načti a pak obnovuj co 8 s
  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(load, 4000);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') load(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [load]));

  async function toggleOnline() {
    const auth = await loadAuth();
    if (!auth.jwt || toggling) return;
    setToggling(true);
    try {
      const r = await api.supportSetOnline(auth.jwt, !online, agent || undefined);
      setOnline(r.online);
    } catch (err) {
      Alert.alert('Nepodařilo se změnit stav', (err as Error).message);
    } finally {
      setToggling(false);
    }
  }

  const totalUnread = threads.reduce((s, t) => s + (t.unread || 0), 0);
  // Čeká na odpověď = zákazník psal naposled a už jsme ji otevřeli (nepřečtená není), ale neodpověděli jsme
  const isWaiting = (t: SupportThread) => t.unread === 0 && t.last_sender === 'user';
  const waitingCount = threads.filter(isWaiting).length;
  const onlineCount = threads.filter((t) => t.online).length;
  const shown = filter === 'unread' ? threads.filter((t) => t.unread > 0)
    : filter === 'waiting' ? threads.filter(isWaiting)
    : filter === 'online' ? threads.filter((t) => t.online) : threads.filter((t) => t.last_at); // „Vše" = jen ti, kdo už psali

  if (loading && threads.length === 0) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sub}>Best Series 2.0{agent ? ` · odpovídáš jako ${agent}` : ''}</Text>
        </View>
        <TouchableOpacity
          style={[styles.statusPill, online ? styles.pillOn : styles.pillOff]}
          onPress={toggleOnline}
          activeOpacity={0.7}
          disabled={toggling}
        >
          <View style={[styles.statusDot, { backgroundColor: online ? colors.success : colors.text2 }]} />
          <Text style={[styles.statusText, { color: online ? colors.success : colors.text2 }]}>
            {online ? 'Online' : 'Offline'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filters}>
        <TouchableOpacity
          style={[styles.chip, filter === 'all' && styles.chipOn]}
          onPress={() => setFilter('all')}
        >
          <Text style={[styles.chipText, filter === 'all' && styles.chipTextOn]}>Vše</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, filter === 'unread' && styles.chipOn]}
          onPress={() => setFilter('unread')}
        >
          <Text style={[styles.chipText, filter === 'unread' && styles.chipTextOn]}>
            Nepřečtené{totalUnread > 0 ? ` ${totalUnread}` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, filter === 'waiting' && styles.chipOn]}
          onPress={() => setFilter('waiting')}
        >
          <View style={styles.chipDot} />
          <Text style={[styles.chipText, filter === 'waiting' && styles.chipTextOn]}>
            Čeká na odpověď{waitingCount > 0 ? ` ${waitingCount}` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, filter === 'online' && styles.chipOn]}
          onPress={() => setFilter('online')}
        >
          <View style={[styles.chipDot, { backgroundColor: '#22c55e' }]} />
          <Text style={[styles.chipText, filter === 'online' && styles.chipTextOn]}>
            Online{onlineCount > 0 ? ` ${onlineCount}` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {!online && (
        <View style={styles.hint}>
          <Text style={styles.hintText}>
            Jsi offline — zákazníci vidí, že podpora teď neodpovídá. Zprávy ti přijdou jako notifikace.
          </Text>
        </View>
      )}
      {error && (
        <TouchableOpacity style={styles.err} onPress={load}>
          <Text style={styles.errText}>{error} Klepni pro obnovení.</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={shown}
        keyExtractor={(t) => String(t.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{filter === 'unread' ? 'Žádné nepřečtené zprávy.' : filter === 'waiting' ? 'Na všechny je odpovězeno.' : filter === 'online' ? 'Právě není nikdo na webu.' : 'Zatím nikdo nepsal.'}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const name = supportName(item);
          const mine = item.last_sender === 'agent';
          return (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.65}
              onPress={() => navigation.navigate('SupportThread', { supporterId: item.id, title: name })}
            >
              <View style={styles.avWrap}>
                <View style={styles.av}><Text style={styles.avText}>{initials(name)}</Text></View>
                <View style={[styles.onDot, !item.online && styles.offDot]} />
                {item.unread === 0 && isWaiting(item) && <View style={styles.waitDot} />}
                {item.unread > 0 && (
                  <View style={styles.badge}><Text style={styles.badgeText}>{item.unread > 99 ? '99+' : item.unread}</Text></View>
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.rowHead}>
                  <Text style={[styles.name, item.unread > 0 && styles.nameUnread]} numberOfLines={1}>{name}</Text>
                  <Text style={styles.time}>{fmtTime(item.last_at)}</Text>
                </View>
                <Text style={[styles.preview, item.unread > 0 && styles.previewUnread]} numberOfLines={1}>
                  {mine ? 'Vy: ' : ''}{item.last_body || ''}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  back: { color: colors.accent2, fontSize: 34, lineHeight: 34, marginRight: 2 },
  header: { color: colors.text, fontSize: 26, fontWeight: '700' },
  sub: { color: colors.text2, fontSize: 12, marginTop: 1 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  pillOn: { borderColor: colors.success, backgroundColor: 'rgba(34,197,94,0.12)' },
  pillOff: { borderColor: colors.border, backgroundColor: colors.surface },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: '700' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  chipDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#f59e0b', marginRight: 6 },
  onDot: { position: 'absolute', bottom: -2, right: -2, width: 15, height: 15, borderRadius: 8, backgroundColor: '#22c55e', borderWidth: 2.5, borderColor: colors.bg },
  offDot: { backgroundColor: '#64748b' },
  waitDot: { position: 'absolute', top: -3, right: -3, width: 16, height: 16, borderRadius: 8, backgroundColor: '#f59e0b', borderWidth: 2, borderColor: colors.bg },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text2, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  hint: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  hintText: { color: colors.text2, fontSize: 12, lineHeight: 17 },
  err: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface2 },
  errText: { color: colors.warning, fontSize: 12 },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.md },
  avWrap: { position: 'relative' },
  av: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  avText: { color: colors.accent2, fontSize: 16, fontWeight: '700' },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  name: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '500', marginRight: spacing.sm },
  nameUnread: { fontWeight: '700' },
  time: { color: colors.text2, fontSize: 11 },
  preview: { color: colors.text2, fontSize: 13 },
  previewUnread: { color: colors.text, fontWeight: '500' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: colors.text2, fontSize: 14 },
});
