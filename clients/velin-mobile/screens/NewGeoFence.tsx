// =============================================================================
// NewGeoFence — vytvoř provoz z aktuální polohy (Velín UX boost)
// =============================================================================
// Flow:
//   1) Postavi se kolega-vedoucí doprostřed dílny / brány
//   2) Otevře tento screen z Attendance
//   3) Vyplní název + radius (default 150 m)
//   4) Stiskne "Změřit a vytvořit"
//   5) Velín si vyžádá foreground GPS, zjistí lat/lng s vysokou přesností
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

export default function NewGeoFence() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [name, setName] = useState('');
  const [radiusM, setRadiusM] = useState('150');
  const [measuring, setMeasuring] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [position, setPosition] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);

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
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Přístup k poloze',
          'Povol Velínu polohu v Nastavení iPhonu.'
        );
        return;
      }
      // High accuracy = trvá déle (5-10 s), ale výrazně přesnější
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });
      setPosition({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy || 0,
      });
    } catch (e) {
      Alert.alert('Chyba GPS', 'Nepodařilo se získat polohu. Zkus to znovu venku, lépe vidí satelity.');
    } finally {
      setMeasuring(false);
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
            <Text style={{ fontWeight: '700' }}> Změřit polohu</Text>. Velín si vezme přesné GPS
            souřadnice a vytvoří z nich kruh, ve kterém pak automaticky pozná příchod/odchod.
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
                <Text style={styles.measureBtnText}>  Měřím polohu…</Text>
              </>
            ) : (
              <Text style={styles.measureBtnText}>
                {position ? '🛰  Změřit znovu' : '🛰  Změřit polohu (5-10 s)'}
              </Text>
            )}
          </TouchableOpacity>

          {position && (
            <View style={styles.posCard}>
              <Text style={styles.posTitle}>📍 Poloha zaznamenána</Text>
              <Text style={styles.posValue}>
                {position.lat.toFixed(6)}, {position.lng.toFixed(6)}
              </Text>
              <Text style={styles.posMeta}>Přesnost: ±{Math.round(position.accuracy)} m</Text>
              {position.accuracy > 30 && (
                <Text style={styles.posWarn}>
                  ⚠ Přesnost horší než 30 m — zkus změřit venku s viditelnou oblohou.
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
