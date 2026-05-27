// =============================================================================
// Attendance — docházka (Fáze 3)
// =============================================================================
// GET  /api/velin/attendance/today — dnešní punches + aktuální stav
// POST /api/velin/attendance/punch — manuální punch (in/out/break_start/break_end)
//
// UI:
//   - Velký status banner — "Jsi v práci od 7:23" / "Mimo provoz"
//   - Tlačítka Příchod / Odchod (nebo Začátek pauzy / Konec pauzy podle stavu)
//   - Seznam dnešních punches (kdy + jak — manual/auto geofence + GPS přesnost)
//   - Tlačítko Auto GPS docházka (Fáze 3 — opt-in)
//
// Background GPS geofencing implementuje lib/geofence.ts (Krok E).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { api, ApiError, type AttendancePunch } from '../lib/api';
import { loadAuth, clearAuth } from '../lib/auth';
import { colors, radius, spacing } from '../lib/theme';
import type { RootStackParamList } from '../App';
import {
  isGeofencingEnabled,
  enableGeofencing,
  disableGeofencing,
} from '../lib/geofence';

type State = 'in' | 'out' | 'break';

export default function Attendance() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [punches, setPunches] = useState<AttendancePunch[]>([]);
  const [currentState, setCurrentState] = useState<State>('out');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [autoGps, setAutoGps] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    navigation.setOptions({
      title: 'Docházka',
      headerShown: true,
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.text,
      headerTitleStyle: { color: colors.text, fontWeight: '600' },
    });
  }, [navigation]);

  const load = useCallback(async () => {
    const auth = await loadAuth();
    if (!auth.jwt) {
      await clearAuth();
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      return;
    }
    try {
      const { punches: ps, currentState: st } = await api.attendanceToday(auth.jwt);
      if (!mountedRef.current) return;
      setPunches(ps);
      setCurrentState(st);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await clearAuth();
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [navigation]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Refresh stavu geofence toggle při focusu
  useFocusEffect(useCallback(() => {
    isGeofencingEnabled().then((on) => {
      if (mountedRef.current) setAutoGps(on);
    });
  }, []));

  async function handlePunch(kind: 'in' | 'out' | 'break_start' | 'break_end') {
    if (submitting) return;
    const auth = await loadAuth();
    if (!auth.jwt) return;

    // Volitelně získat aktuální polohu (pokud uživatel povolil)
    let lat: number | null = null;
    let lng: number | null = null;
    let accuracy_m: number | null = null;
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.granted) {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
        accuracy_m = pos.coords.accuracy ?? null;
      }
    } catch {
      // GPS selhala — pokračujeme bez souřadnic
    }

    setSubmitting(true);
    try {
      await api.attendancePunch(auth.jwt, {
        kind,
        lat,
        lng,
        accuracy_m,
        source: 'velin_manual',
      });
      await load();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Nepodařilo se zaznamenat docházku.';
      Alert.alert('Chyba', msg);
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  }

  async function toggleAutoGps(next: boolean) {
    if (next) {
      const ok = await enableGeofencing();
      if (!ok) {
        Alert.alert(
          'Nepodařilo se zapnout',
          'Buď nepovolil/a polohu na pozadí (Vždy), nebo zatím neexistuje žádný provoz s GPS fence. Šéf ti pomůže.'
        );
        return;
      }
      setAutoGps(true);
    } else {
      await disableGeofencing();
      setAutoGps(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  const firstIn = punches.find((p) => p.kind === 'in');

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Status banner */}
        <View style={[styles.statusBanner, statusStyles(currentState)]}>
          <Text style={styles.statusEmoji}>{statusEmoji(currentState)}</Text>
          <Text style={styles.statusText}>
            {currentState === 'in' && firstIn
              ? `V práci od ${timeStr(firstIn.punched_at)}`
              : currentState === 'break'
              ? 'Na pauze'
              : 'Mimo provoz'}
          </Text>
        </View>

        {/* Velké akční tlačítka */}
        <View style={styles.buttonsRow}>
          {currentState === 'out' && (
            <BigBtn label="Příchod" icon="🚪" onPress={() => handlePunch('in')} disabled={submitting} color={colors.success} />
          )}
          {currentState === 'in' && (
            <>
              <BigBtn label="Pauza" icon="☕" onPress={() => handlePunch('break_start')} disabled={submitting} color={colors.warning} />
              <BigBtn label="Odchod" icon="👋" onPress={() => handlePunch('out')} disabled={submitting} color={colors.danger} />
            </>
          )}
          {currentState === 'break' && (
            <BigBtn label="Konec pauzy" icon="▶️" onPress={() => handlePunch('break_end')} disabled={submitting} color={colors.success} />
          )}
        </View>

        {/* Auto GPS toggle */}
        <View style={styles.autoCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.autoTitle}>🛰 Auto GPS docházka</Text>
            <Text style={styles.autoSub}>
              Velín si sám zaznamená příchod/odchod, když projdeš branou. Vyžaduje povolení polohy „Vždy".
            </Text>
          </View>
          <Switch
            value={autoGps}
            onValueChange={toggleAutoGps}
            trackColor={{ false: colors.surface2, true: colors.accent }}
            thumbColor="#fff"
          />
        </View>

        {/* Seznam dnešních punches */}
        <Text style={styles.sectionTitle}>Dnešní záznamy ({punches.length})</Text>
        {punches.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Dnes ještě žádný záznam.</Text>
          </View>
        ) : (
          punches.map((p) => (
            <View key={p.id} style={styles.punchRow}>
              <Text style={styles.punchTime}>{timeStr(p.punched_at)}</Text>
              <Text style={styles.punchKind}>{kindLabel(p.kind)}</Text>
              <Text style={styles.punchMeta}>
                {p.source === 'velin_geofence_auto' ? '🛰 auto' : '✋ ručně'}
                {p.inside_fence ? ' · ✓ v provoze' : p.lat ? ' · ⚠ mimo' : ''}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function BigBtn({
  label,
  icon,
  onPress,
  disabled,
  color,
}: {
  label: string;
  icon: string;
  onPress: () => void;
  disabled?: boolean;
  color: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.bigBtn, { backgroundColor: color }, disabled && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      <Text style={styles.bigBtnIcon}>{icon}</Text>
      <Text style={styles.bigBtnLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function statusEmoji(s: State): string {
  if (s === 'in') return '✅';
  if (s === 'break') return '☕';
  return '🏠';
}

function statusStyles(s: State) {
  if (s === 'in') return { backgroundColor: 'rgba(34,197,94,0.15)', borderColor: 'rgba(34,197,94,0.3)' };
  if (s === 'break') return { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.3)' };
  return { backgroundColor: 'rgba(148,163,184,0.15)', borderColor: 'rgba(148,163,184,0.3)' };
}

function kindLabel(k: string): string {
  if (k === 'in') return 'Příchod';
  if (k === 'out') return 'Odchod';
  if (k === 'break_start') return 'Začátek pauzy';
  if (k === 'break_end') return 'Konec pauzy';
  return k;
}

function timeStr(iso: string): string {
  return new Date(iso).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.xl,
    gap: spacing.md,
  },
  statusEmoji: { fontSize: 36 },
  statusText: { color: colors.text, fontSize: 18, fontWeight: '600', flex: 1 },

  buttonsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  bigBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.xl,
    borderRadius: radius.lg,
  },
  bigBtnIcon: { fontSize: 32, marginBottom: spacing.xs },
  bigBtnLabel: { color: '#0b1220', fontSize: 16, fontWeight: '700' },

  autoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xl,
    gap: spacing.md,
  },
  autoTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  autoSub: { color: colors.text2, fontSize: 12, marginTop: 2, lineHeight: 16 },

  sectionTitle: {
    color: colors.text2,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  emptyText: { color: colors.text2, fontSize: 13 },

  punchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  punchTime: { color: colors.text, fontSize: 15, fontWeight: '600', minWidth: 56 },
  punchKind: { color: colors.text, fontSize: 14, flex: 1 },
  punchMeta: { color: colors.text2, fontSize: 11 },
});
