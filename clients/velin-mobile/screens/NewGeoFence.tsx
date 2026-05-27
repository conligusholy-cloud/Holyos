// =============================================================================
// NewGeoFence — vytvoř provoz z aktuální polohy (Velín UX boost)
// =============================================================================
// Flow:
//   1) Postavi se kolega-vedoucí doprostřed dílny / brány
//   2) Otevře tento screen z Attendance
//   3) Vyplní název + radius (default 150 m)
//   4) Stiskne "Změřit a vytvořit"
//   5) Velín si vyžádá foreground GPS, posbírá 8 vzorků a vezme medián
//   6) POST /api/velin/fences/from-here (admin guard na backendu)
//   7) Alert s úspěchem → goBack
//
// Backend vrací 403, pokud user není admin/manager — pak ukážeme alert.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { api, ApiError } from '../lib/api';
import { loadAuth, clearAuth } from '../lib/auth';
import { colors, radius, spacing } from '../lib/theme';
import type { RootStackParamList } from '../App';

// =============================================================================
// Vícenásobné měření — medián z 8 vzorků
// =============================================================================
// Single-shot GPS má v dílně (kovová střecha, panely) typickou přesnost 15-40 m
// s rozptylem ±10 m mezi po sobě jdoucími měřeními. Když změříme 8× za sebou
// a vezmeme medián lat/lng, vychýlené vzorky (outliers) se odfiltrují a střed
// kruhu sedne přesněji do reálného středu provozu.
//
// SAMPLE_INTERVAL_MS = 900 — telefon má dost času zachytit nové satelitní fixy.
// Outlier filter (>30 m) se aplikuje jen pokud zbyde alespoň 4 dobré vzorky.
const SAMPLE_COUNT = 8;
const SAMPLE_INTERVAL_MS = 900;

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export default function NewGeoFence() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [name, setName] = useState('');
  const [radiusM, setRadiusM] = useState('150');
  const [measuring, setMeasuring] = useState(false);
  const [measureProgress, setMeasureProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [position, setPosition] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
    samples: number;
  } | null>(null);

  useEffect(() => {
    navigation.setOptions({
      title: 'Nový provoz (GPS)',
      headerShown: true,
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.text,
      headerTitleStyle: { color: colors.text, fontWeight: '600' },
    });
  }, [navigation]);

  async function handleMeasure() {
    setMeasuring(true);
    setMeasureProgress(0);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Přístup k poloze',
          'Povol Velínu polohu v Nastavení iPhonu.'
        );
        return;
      }

      // Posbírej SAMPLE_COUNT vzorků s krátkou pauzou mezi nimi
      const samples: Array<{ lat: number; lng: number; accuracy: number }> = [];
      for (let i = 0; i < SAMPLE_COUNT; i++) {
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.BestForNavigation,
          });
          samples.push({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy || 999,
          });
        } catch {
          // Tichý fail jednoho vzorku — pokračujeme dál
        }
        setMeasureProgress(i + 1);
        if (i < SAMPLE_COUNT - 1) {
          await new Promise((resolve) => setTimeout(resolve, SAMPLE_INTERVAL_MS));
        }
      }

      if (samples.length === 0) {
        Alert.alert(
          'Chyba GPS',
          'Nepodařilo se získat žádnou polohu. Zkus to venku, kde lépe vidíš oblohu.'
        );
        return;
      }

      // Outlier filter: pokud máme aspoň 4 vzorky lepší než 30 m, použij jen ty
      const goodSamples = samples.filter((s) => s.accuracy <= 30);
      const useSamples = goodSamples.length >= 4 ? goodSamples : samples;

      const medLat = median(useSamples.map((s) => s.lat));
      const medLng = median(useSamples.map((s) => s.lng));
      const bestAccuracy = Math.min(...useSamples.map((s) => s.accuracy));

      setPosition({
        lat: medLat,
        lng: medLng,
        accuracy: bestAccuracy,
        samples: useSamples.length,
      });
    } catch (e) {
      Alert.alert('Chyba GPS', 'Nepodařilo se získat polohu. Zkus to znovu venku, lépe vidí satelity.');
    } finally {
      setMeasuring(false);
      setMeasureProgress(0);
    }
  }

  async function handleSubmit() {
    if (submitting) return;
    if (!name.trim()) {
      Alert.alert('Chybí název', 'Pojmenuj provoz, např. „Dílna" nebo „Hlavní hala".');
      return;
    }
    if (!position) {
      Alert.alert('Chybí poloha', 'Nejdřív stiskni "Změřit polohu".');
      return;
    }
    const r = parseInt(radiusM, 10) || 150;
    if (r < 20 || r > 2000) {
      Alert.alert('Špatný poloměr', 'Radius musí být mezi 20 m a 2000 m.');
      return;
    }

    const auth = await loadAuth();
    if (!auth.jwt) {
      await clearAuth();
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      return;
    }

    setSubmitting(true);
    try {
      const { fence } = await api.createGeoFenceFromHere(auth.jwt, {
        name: name.trim(),
        lat: position.lat,
        lng: position.lng,
        radius_m: r,
      });
      Alert.alert(
        'Hotovo!',
        `Provoz „${fence.name}" vytvořen (${fence.radius_m} m kolem aktuální polohy). Teď můžeš zapnout 🛰 Auto GPS docházku.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        Alert.alert('Nepovoleno', 'Provoz může vytvořit jen vedoucí / admin.');
        return;
      }
      const msg = err instanceof ApiError ? err.message : 'Nepodařilo se vytvořit provoz.';
      Alert.alert('Chyba', msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.intro}>
            Postav se přesně doprostřed provozu (např. uprostřed dílny, nebo u brány) a stiskni
            <Text style={{ fontWeight: '700' }}> Změřit polohu</Text>. Velín posbírá 8 GPS vzorků
            a vezme z nich medián — to výrazně zpřesní střed kruhu i uvnitř budovy. Měření trvá
            cca 10 sekund, drž telefon klidně.
          </Text>

          <Text style={styles.label}>Název provozu</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="např. Dílna, Hlavní hala, Provoz Velké Hamry"
            placeholderTextColor={colors.text2}
            maxLength={100}
          />

          <Text style={styles.label}>Poloměr (m)</Text>
          <TextInput
            style={styles.input}
            value={radiusM}
            onChangeText={setRadiusM}
            placeholder="150"
            placeholderTextColor={colors.text2}
            keyboardType="number-pad"
            maxLength={4}
          />
          <Text style={styles.hint}>
            Doporučeno 100–200 m. Větší kruh = příchod se zaznamená dřív, ale i náhodný kolemjdoucí
            může omylem spustit punch.
          </Text>

          {/* GPS měření */}
          <TouchableOpacity
            style={[styles.measureBtn, measuring && styles.btnDisabled]}
            onPress={handleMeasure}
            disabled={measuring || submitting}
          >
            {measuring ? (
              <>
                <ActivityIndicator color={colors.text} />
                <Text style={styles.measureBtnText}>
                  {`  Měřím polohu… ${measureProgress}/${SAMPLE_COUNT}`}
                </Text>
              </>
            ) : (
              <Text style={styles.measureBtnText}>
                {position ? '🛰  Změřit znovu' : '🛰  Změřit polohu (cca 10 s)'}
              </Text>
            )}
          </TouchableOpacity>

          {position && (
            <View style={styles.posCard}>
              <Text style={styles.posTitle}>📍 Poloha zaznamenána (medián)</Text>
              <Text style={styles.posValue}>
                {position.lat.toFixed(6)}, {position.lng.toFixed(6)}
              </Text>
              <Text style={styles.posMeta}>
                Přesnost: ±{Math.round(position.accuracy)} m · {position.samples} vzorků
              </Text>
              {position.accuracy > 30 && (
                <Text style={styles.posWarn}>
                  ⚠ Přesnost horší než 30 m — pro lepší výsledek zkus měřit venku s viditelnou
                  oblohou, nebo zvyš poloměr ({Math.max(150, Math.round(position.accuracy * 3))} m).
                </Text>
              )}
            </View>
          )}

          <TouchableOpacity
            style={[styles.submitBtn, (!position || submitting) && styles.btnDisabled]}
            onPress={handleSubmit}
            disabled={!position || submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#0b1220" />
            ) : (
              <Text style={styles.submitBtnText}>Vytvořit provoz</Text>
            )}
          </TouchableOpacity>

          <View style={{ height: spacing.xxl }} />
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  intro: {
    color: colors.text2,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  hint: { color: colors.text2, fontSize: 12, marginTop: spacing.xs, lineHeight: 16 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
    padding: spacing.md,
  },
  measureBtn: {
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  measureBtnText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  posCard: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)',
  },
  posTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
  posValue: { color: colors.text, fontSize: 16, marginTop: 4, fontVariant: ['tabular-nums'] },
  posMeta: { color: colors.text2, fontSize: 12, marginTop: 4 },
  posWarn: { color: colors.warning, fontSize: 12, marginTop: 6 },
  submitBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  submitBtnText: { color: '#0b1220', fontSize: 16, fontWeight: '700' },
});
