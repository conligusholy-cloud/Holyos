// =============================================================================
// MyDay — hlavní obrazovka, dnešní plán a úkoly
// =============================================================================
// GET /api/velin/my-day → DailyPlan s assignments + overdue z minulých dnů.
// Tap na úkol → TaskDetail.
//
// Strategie: STALE-WHILE-REVALIDATE.
//   1) Při mountu načteme cache (lib/cache.ts) → pokud existuje, hned ji
//      vyrendrujeme (žádný spinner) a označíme jako "stale".
//   2) Paralelně zavoláme API.
//   3) Při úspěchu: nahradíme data čerstvými + uložíme do cache.
//   4) Při network/timeout: necháme data z cache + ukážeme proužek
//      "Server neodpovídá, naposledy obnoveno před X min".
//   5) Při 401: smažeme auth + reset na Login.
//
// Cache key obsahuje person_id (aby více kolegů na jednom iPadu nesdíleli plán).

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api, ApiError } from '../lib/api';
import { loadAuth, clearAuth } from '../lib/auth';
import { getCache, setCache, formatCacheAge } from '../lib/cache';
import { colors, radius, spacing } from '../lib/theme';
import type { RootStackParamList } from '../App';

// Stavy chyb pro UI rozhodování.
type LoadError =
  | { kind: 'network' }       // timeout / offline / DNS — token NEMAŽEME
  | { kind: 'server'; message: string }; // 5xx, 400, atd.

type Task = {
  id: number;
  title: string;
  description: string | null;
  priority: number;
  estimated_min: number | null;
  due_at: string | null;
  status: string;
  location_hint: string | null;
  source: string;
};

type DayData = {
  date: string;
  plan: { id: number; status: string; assignments: Task[] } | null;
  overdue: Task[];
};

function cacheKey(personId: number | null) {
  return `my-day:${personId ?? 'unknown'}`;
}

export default function MyDay() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [data, setData] = useState<DayData | null>(null);
  const [cacheAge, setCacheAge] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);
  const [greeting, setGreeting] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async (mode: 'mount' | 'refresh') => {
    const auth = await loadAuth();
    if (!auth.jwt) {
      await clearAuth();
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      return;
    }
    if (mountedRef.current) {
      setGreeting(buildGreeting(auth.displayName || auth.username));
    }
    const key = cacheKey(auth.personId);

    if (mode === 'mount') {
      const cached = await getCache<DayData>(key);
      if (cached && mountedRef.current) {
        setData(cached.value);
        setCacheAge(formatCacheAge(cached.savedAt));
        setLoading(false);
      }
    }

    try {
      const fresh = (await api.myDay(auth.jwt)) as DayData;
      if (!mountedRef.current) return;
      setData(fresh);
      setCacheAge(null);
      setError(null);
      await setCache(key, fresh);
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ApiError) {
        if (err.status === 401) {
          await clearAuth();
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
          return;
        }
        if (err.status === 0) {
          setError({ kind: 'network' });
        } else {
          setError({ kind: 'server', message: err.message });
        }
      } else {
        setError({ kind: 'server', message: 'Nepodařilo se načíst dnešní plán.' });
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [navigation]);

  useEffect(() => {
    load('mount');
  }, [load]);

  useFocusEffect(useCallback(() => { load('refresh'); }, [load]));

  function openTask(taskId: number) {
    navigation.navigate('TaskDetail', { taskId });
  }

  function handleRetry() {
    setError(null);
    load('refresh');
  }

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (!data && error && error.kind === 'network') {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <View style={styles.retryBox}>
          <Text style={styles.retryEmoji}>📡</Text>
          <Text style={styles.retryTitle}>Server neodpovídá</Text>
          <Text style={styles.retrySub}>
            Možná je v cold startu nebo nemáš signál. Zůstáváš přihlášen.
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
            <Text style={styles.retryBtnText}>Zkusit znovu</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const tasks = data?.plan?.assignments || [];
  const overdue = data?.overdue || [];
  const hasStaleData = data && (cacheAge !== null || error !== null);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load('refresh');
            }}
            tintColor={colors.accent}
          />
        }
      >
        <Text style={styles.greeting}>{greeting}</Text>
        <Text style={styles.subhead}>{czechDate(new Date(data?.date || Date.now()))}</Text>

        {hasStaleData && (
          <TouchableOpacity onPress={handleRetry} style={styles.staleBanner} activeOpacity={0.7}>
            <Text style={styles.staleBannerText}>
              {error && error.kind === 'network'
                ? `📡 Server neodpovídá. Vidíš plán${cacheAge ? ` z ${cacheAge}` : ''}.`
                : error && error.kind === 'server'
                ? `⚠ ${error.message}${cacheAge ? ` · plán z ${cacheAge}` : ''}`
                : `🕓 Naposledy obnoveno ${cacheAge}`}
            </Text>
            <Text style={styles.staleBannerHint}>Klepni pro obnovení</Text>
          </TouchableOpacity>
        )}

        {overdue.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>⚠ Nedokončené z minulých dnů ({overdue.length})</Text>
            {overdue.map((t) => (
              <TaskCard key={t.id} task={t} overdue onPress={() => openTask(t.id)} />
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>📅 Dnes ({tasks.length})</Text>
          {tasks.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>Dnes nemáš zatím přidělené žádné úkoly.</Text>
              <Text style={styles.emptyTextSmall}>Když přijde nový úkol, dorazí ti push notifikace.</Text>
            </View>
          ) : (
            tasks.map((t) => <TaskCard key={t.id} task={t} onPress={() => openTask(t.id)} />)
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function TaskCard({ task, overdue, onPress }: { task: Task; overdue?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.taskCard, overdue && styles.taskCardOverdue]}
      onPress={onPress}
    >
      <View style={styles.taskHead}>
        <Text style={styles.taskTitle} numberOfLines={2}>
          {task.title}
        </Text>
        <StatusBadge status={task.status} />
      </View>
      {task.description ? (
        <Text style={styles.taskDesc} numberOfLines={2}>
          {task.description}
        </Text>
      ) : null}
      <View style={styles.taskMeta}>
        {task.estimated_min ? <Meta icon="⏱" text={`${task.estimated_min} min`} /> : null}
        {task.due_at ? <Meta icon="📅" text={shortTime(task.due_at)} /> : null}
        {task.location_hint ? <Meta icon="📍" text={task.location_hint} /> : null}
        <Meta icon="🏷" text={task.source} />
      </View>
    </TouchableOpacity>
  );
}

function Meta({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.metaChip}>
      <Text style={styles.metaText}>
        {icon} {text}
      </Text>
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    proposed:    { label: 'Navrženo', bg: 'rgba(148,163,184,0.18)', fg: '#cbd5e1' },
    accepted:    { label: 'Přijato', bg: 'rgba(14,165,233,0.18)', fg: '#7dd3fc' },
    in_progress: { label: 'Probíhá', bg: 'rgba(245,158,11,0.22)', fg: '#fbbf24' },
    blocked:     { label: 'Blokováno', bg: 'rgba(239,68,68,0.22)', fg: '#fca5a5' },
    done:        { label: 'Hotovo', bg: 'rgba(34,197,94,0.22)', fg: '#86efac' },
  };
  const it = map[status] || map.proposed;
  return (
    <View style={[styles.statusBadge, { backgroundColor: it.bg }]}>
      <Text style={[styles.statusBadgeText, { color: it.fg }]}>{it.label}</Text>
    </View>
  );
}

function buildGreeting(name: string | null) {
  const h = new Date().getHours();
  const part = h < 11 ? 'Dobré ráno' : h < 17 ? 'Dobrý den' : 'Dobrý večer';
  return name ? `${part}, ${name.split(' ')[0]}` : part;
}

function czechDate(d: Date) {
  return d.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' });
}

function shortTime(iso: string) {
  return new Date(iso).toLocaleString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'numeric',
  });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  scroll: { padding: spacing.xl, paddingBottom: 48 },
  greeting: { color: colors.text, fontSize: 24, fontWeight: '700' },
  subhead: { color: colors.text2, fontSize: 13, marginTop: spacing.xs, marginBottom: spacing.xl },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.md },
  section: { marginBottom: spacing.xl },
  sectionHeader: {
    color: colors.text2,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  emptyText: { color: colors.text, fontSize: 15, fontWeight: '500' },
  emptyTextSmall: { color: colors.text2, fontSize: 12, marginTop: spacing.xs },
  taskCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  taskCardOverdue: { borderColor: 'rgba(239,68,68,0.4)' },
  taskHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  taskTitle: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  taskDesc: { color: colors.text2, fontSize: 13, marginTop: spacing.xs },
  taskMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  metaChip: {
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  metaText: { color: colors.text2, fontSize: 11 },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusBadgeText: { fontSize: 11, fontWeight: '600' },
  retryBox: { alignItems: 'center', paddingHorizontal: spacing.xl, maxWidth: 320 },
  retryEmoji: { fontSize: 48, marginBottom: spacing.md },
  retryTitle: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: spacing.sm },
  retrySub: {
    color: colors.text2,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  retryBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  retryBtnText: { color: '#0b1220', fontSize: 15, fontWeight: '700' },
  staleBanner: {
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  staleBannerText: { color: colors.text, fontSize: 13, fontWeight: '500' },
  staleBannerHint: { color: colors.text2, fontSize: 11, marginTop: 2 },
});
