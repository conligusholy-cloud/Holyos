// =============================================================================
// Me — profil a odhlášení
// =============================================================================

import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CommonActions, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { loadAuth, clearAuth, AuthSnapshot } from '../lib/auth';
import { API_BASE } from '../lib/api';
import { colors, radius, spacing } from '../lib/theme';
import type { RootStackParamList } from '../App';
import Constants from 'expo-constants';

export default function Me() {
  const [auth, setAuth] = useState<AuthSnapshot | null>(null);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const appVersion = Constants.expoConfig?.version || '0.1.0';

  useEffect(() => {
    loadAuth().then(setAuth);
  }, []);

  function confirmLogout() {
    Alert.alert(
      'Odhlásit se',
      'Po odhlášení budeš muset zadat HolyOS heslo znovu. Notifikace ti přestanou chodit, dokud se znovu nepřihlásíš.',
      [
        { text: 'Zrušit', style: 'cancel' },
        {
          text: 'Odhlásit',
          style: 'destructive',
          onPress: async () => {
            await clearAuth();
            navigation.dispatch(
              CommonActions.reset({ index: 0, routes: [{ name: 'Login' as never }] })
            );
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(auth?.displayName || auth?.username || '?').slice(0, 2).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.name}>{auth?.displayName || '—'}</Text>
        <Text style={styles.username}>@{auth?.username || '—'}</Text>

        <View style={styles.card}>
          <Row label="Person ID" value={auth?.personId ? String(auth.personId) : '—'} />
          <Row label="HolyOS" value={API_BASE} />
          <Row label="Verze aplikace" value={appVersion} />
        </View>

        <TouchableOpacity
          style={styles.reflectionBtn}
          onPress={() => navigation.navigate('Attendance')}
        >
          <Text style={styles.reflectionBtnText}>⏱  Docházka</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.reflectionBtn, { marginTop: spacing.md }]}
          onPress={() => navigation.navigate('EveningReflection')}
        >
          <Text style={styles.reflectionBtnText}>🌙  Dnešní reflexe</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutBtn} onPress={confirmLogout}>
          <Text style={styles.logoutText}>Odhlásit se</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>Velín · Best Series s.r.o.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.xl, paddingBottom: 60, alignItems: 'center' },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    marginTop: spacing.lg,
  },
  avatarText: { color: '#fff', fontSize: 28, fontWeight: '700' },
  name: { color: colors.text, fontSize: 20, fontWeight: '600' },
  username: { color: colors.text2, fontSize: 13, marginTop: 2 },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
    gap: spacing.md,
  },
  rowLabel: { color: colors.text2, fontSize: 13 },
  rowValue: { color: colors.text, fontSize: 13, flexShrink: 1, textAlign: 'right' },
  reflectionBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xxl,
    alignItems: 'center',
    width: '100%',
  },
  reflectionBtnText: { color: '#0b1220', fontWeight: '700', fontSize: 15 },
  logoutBtn: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderColor: 'rgba(239,68,68,0.3)',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
  logoutText: { color: colors.danger, fontWeight: '600', fontSize: 15 },
  footer: { color: colors.text2, fontSize: 11, marginTop: spacing.xxl },
});
