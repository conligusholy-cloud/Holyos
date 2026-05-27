// =============================================================================
// EveningReflection — večerní 3 minutová reflexe
// =============================================================================
// GET /api/velin/feedback/evening (pre-fill, pokud už dnes existuje)
// POST /api/velin/feedback/evening (upsert per person+date)
//
// Cíl: nejjednodušší formulář, který kolega vyplní za 1-3 minuty:
//   - Mood 😞😕😐🙂😄 (1-5) — jaký den měl
//   - Energy 🔋 (1-5) — kolik mu zbývá síly
//   - Wins (volitelné) — co se povedlo
//   - Struggles (volitelné) — co bylo těžké
//   - Tomorrow focus (volitelné) — co dělat zítra prioritně
//   - Free text (volitelné) — cokoli dalšího
//
// Po submitu navigation.goBack() + Alert "Děkujeme". Vedoucí to v admin
// dashboardu uvidí.

import React, { useCallback, useEffect, useState } from 'react';
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
import { api, ApiError } from '../lib/api';
import { loadAuth, clearAuth } from '../lib/auth';
import { colors, radius, spacing } from '../lib/theme';
import type { RootStackParamList } from '../App';

const MOOD_EMOJI = ['😞', '😕', '😐', '🙂', '😄'];
const ENERGY_EMOJI = ['🪫', '🔋', '🔋', '🔋', '⚡'];

export default function EveningReflection() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [mood, setMood] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [wins, setWins] = useState('');
  const [struggles, setStruggles] = useState('');
  const [tomorrowFocus, setTomorrowFocus] = useState('');
  const [freeText, setFreeText] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);

  useEffect(() => {
    navigation.setOptions({
      title: 'Večerní reflexe',
      headerShown: true,
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.text,
      headerTitleStyle: { color: colors.text, fontWeight: '600' },
    });
  }, [navigation]);

  // Pre-fill, pokud uživatel už dnes reflexi odeslal (jiné zařízení / dřív v den)
  const load = useCallback(async () => {
    const auth = await loadAuth();
    if (!auth.jwt) {
      await clearAuth();
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      return;
    }
    try {
      const { reflection } = await api.getEveningReflection(auth.jwt);
      if (reflection) {
        setMood(reflection.mood);
        setEnergy(reflection.energy);
        setWins(reflection.wins || '');
        setStruggles(reflection.struggles || '');
        setTomorrowFocus(reflection.tomorrow_focus || '');
        setFreeText(reflection.free_text || '');
        setAlreadySubmitted(true);
      }
    } catch (err) {
      // Pre-fill je nice-to-have, tichý fail
      if (err instanceof ApiError && err.status === 401) {
        await clearAuth();
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      }
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit() {
    if (submitting) return;
    const auth = await loadAuth();
    if (!auth.jwt) return;

    // Aspoň jedno pole musí být vyplněné, jinak nemá smysl posílat
    if (mood === null && energy === null && !wins.trim() && !struggles.trim() && !tomorrowFocus.trim() && !freeText.trim()) {
      Alert.alert('Prázdná reflexe', 'Vyplň alespoň náladu nebo jedno pole.');
      return;
    }

    setSubmitting(true);
    try {
      await api.submitEveningReflection(auth.jwt, {
        mood,
        energy,
        wins: wins.trim() || null,
        struggles: struggles.trim() || null,
        tomorrow_focus: tomorrowFocus.trim() || null,
        free_text: freeText.trim() || null,
      });
      Alert.alert(
        alreadySubmitted ? 'Aktualizováno' : 'Děkujeme!',
        alreadySubmitted
          ? 'Reflexe pro dnešek byla aktualizována.'
          : 'Hezký večer 🌙',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await clearAuth();
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        return;
      }
      const msg = err instanceof ApiError ? err.message : 'Nepodařilo se odeslat reflexi.';
      Alert.alert('Chyba', msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
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
            Krátká zpětná vazba na dnešní den. Vyplň co chceš — i jen smajlík stačí.
          </Text>

          {alreadySubmitted && (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                ℹ Pro dnešek jsi už reflexi odeslal. Můžeš ji upravit a poslat znovu.
              </Text>
            </View>
          )}

          {/* MOOD */}
          <Text style={styles.label}>Jaký byl den?</Text>
          <View style={styles.emojiRow}>
            {MOOD_EMOJI.map((e, i) => {
              const value = i + 1;
              const selected = mood === value;
              return (
                <TouchableOpacity
                  key={value}
                  style={[styles.emojiBtn, selected && styles.emojiBtnSelected]}
                  onPress={() => setMood(selected ? null : value)}
                  activeOpacity={0.65}
                >
                  <Text style={styles.emoji}>{e}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ENERGY */}
          <Text style={styles.label}>Kolik máš ještě síly?</Text>
          <View style={styles.emojiRow}>
            {ENERGY_EMOJI.map((e, i) => {
              const value = i + 1;
              const selected = energy === value;
              return (
                <TouchableOpacity
                  key={value}
                  style={[styles.emojiBtn, selected && styles.emojiBtnSelected]}
                  onPress={() => setEnergy(selected ? null : value)}
                  activeOpacity={0.65}
                >
                  <Text style={styles.emoji}>{e}</Text>
                  <Text style={styles.energyNum}>{value}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* TEXT POLE */}
          <Text style={styles.label}>Co se dnes povedlo? <Text style={styles.optional}>(nepovinné)</Text></Text>
          <TextInput
            style={styles.textarea}
            value={wins}
            onChangeText={setWins}
            placeholder="Třeba: dokončil jsem montáž, pomohl jsem Honzovi…"
            placeholderTextColor={colors.text2}
            multiline
            maxLength={1000}
          />

          <Text style={styles.label}>Co bylo těžké? <Text style={styles.optional}>(nepovinné)</Text></Text>
          <TextInput
            style={styles.textarea}
            value={struggles}
            onChangeText={setStruggles}
            placeholder="Třeba: chyběl mi nářad, čekal jsem na materiál…"
            placeholderTextColor={colors.text2}
            multiline
            maxLength={1000}
          />

          <Text style={styles.label}>Na co se zítra zaměřit? <Text style={styles.optional}>(nepovinné)</Text></Text>
          <TextInput
            style={styles.textarea}
            value={tomorrowFocus}
            onChangeText={setTomorrowFocus}
            placeholder="Třeba: dodělat sestavu, zavolat dodavateli…"
            placeholderTextColor={colors.text2}
            multiline
            maxLength={1000}
          />

          <Text style={styles.label}>Cokoli dalšího? <Text style={styles.optional}>(nepovinné)</Text></Text>
          <TextInput
            style={styles.textarea}
            value={freeText}
            onChangeText={setFreeText}
            placeholder="Nápady, postřehy, prosby šéfovi…"
            placeholderTextColor={colors.text2}
            multiline
            maxLength={2000}
          />

          <TouchableOpacity
            style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#0b1220" />
            ) : (
              <Text style={styles.submitBtnText}>
                {alreadySubmitted ? 'Aktualizovat reflexi' : 'Odeslat reflexi'}
              </Text>
            )}
          </TouchableOpacity>

          <View style={{ height: spacing.xxl }} />
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  intro: {
    color: colors.text2,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.xl,
  },

  notice: {
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noticeText: { color: colors.text, fontSize: 13 },

  label: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  optional: { color: colors.text2, fontSize: 12, fontWeight: '400' },

  emojiRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  emojiBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginHorizontal: 4,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
  },
  emojiBtnSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.surface2,
  },
  emoji: { fontSize: 28 },
  energyNum: { color: colors.text2, fontSize: 11, marginTop: 2 },

  textarea: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
    padding: spacing.md,
    minHeight: 70,
    textAlignVertical: 'top',
  },

  submitBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: '#0b1220', fontSize: 16, fontWeight: '700' },
});
