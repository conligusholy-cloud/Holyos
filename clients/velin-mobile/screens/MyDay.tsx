// =============================================================================
// MyDay — hlavní obrazovka, dnešní plán a úkoly
// =============================================================================
// GET /api/velin/my-day → DailyPlan s assignments + overdue z minulých dnů.
// Tap na úkol → TaskDetail (Fáze 1 — zatím jen logujeme).

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
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api, ApiError } from '../lib/api';
import { loadAuth } from '../lib/auth';
import { colors, radius, spacing } from '../lib/theme';
import type { RootStackParamList } from '../App';

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

export default function MyDay() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [data, setData] = useState<DayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [greeting, setGreeting] = useState('');

  const load = useCallback(async () => {
    setError(null);
    const auth = await loadAuth();
    if (!auth.jwt) {
      setError('Nepřihlášen.');
      setLoading(false);
      return;
    }
    setGreeting(buildGreeting(auth.displayName || auth.username));
    try {
      const d = await api.myDay(auth.jwt);
      setData(d as DayData);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Nepodařilo se načíst dnešní plán.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Při návratu z TaskDetail refreshneme, ať vidíme aktuální stav
  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openTask(taskId: number) {
    navigation.navigate('TaskDetail', { taskId });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  const tasks = data?.plan?.assignments || [];
  const overdue = data?.overdue || [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.accent}
          />
        }
      >
        <Text style={styles.greeting}>{greeting}</Text>
        <Text style={styles.subhead}>{czechDate(new Date(data?.date || Date.now()))}</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

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
});
