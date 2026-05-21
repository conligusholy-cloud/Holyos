// =============================================================================
// Login — HolyOS přihlášení (username + heslo)
// =============================================================================
// Po úspěšném přihlášení:
//   1) Uložíme JWT a profil do SecureStore.
//   2) Zaregistrujeme zařízení pro push — vyžádáme si oprávnění,
//      získáme Expo push token a pošleme ho na /api/velin/devices/register.
//   3) Pokračujeme na Tabs (MyDay).

import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { api, ApiError } from '../lib/api';
import { saveAuth } from '../lib/auth';
import { registerForPushNotifications } from '../lib/push';
import { colors, radius, spacing } from '../lib/theme';
import type { RootStackParamList } from '../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>;

export default function Login({ navigation }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (!username.trim() || !password) {
      setError('Vyplň prosím jméno i heslo.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const loginRes = await api.login(username.trim(), password);
      const user = loginRes.user;
      const personId = user.person?.id;
      if (!personId) {
        setError(
          'Tvůj účet nemá propojený Person záznam — Velín potřebuje, aby ti admin spojil User s Person v HolyOS.'
        );
        setLoading(false);
        return;
      }
      await saveAuth({
        jwt: loginRes.token,
        userId: user.id,
        personId,
        displayName: user.displayName || user.display_name || user.username,
        username: user.username,
      });

      // Push registrace — selhání není fatální, jen logujeme.
      try {
        const device = await registerForPushNotifications();
        if (device) {
          await api.registerDevice(loginRes.token, device);
        }
      } catch (e: any) {
        console.warn('[Login] Push registrace selhala:', e?.message || e);
      }

      navigation.replace('Tabs');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || `Chyba ${err.status}`);
      } else {
        setError('Nepodařilo se připojit k HolyOS.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.brand}>
        <Text style={styles.brandTitle}>Velín</Text>
        <Text style={styles.brandSubtitle}>Tvůj kapesní HolyOS</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Uživatelské jméno</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="např. tomas.holy"
          placeholderTextColor={colors.text2}
        />
        <Text style={styles.label}>Heslo</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor={colors.text2}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Přihlásit se</Text>
          )}
        </TouchableOpacity>
      </View>
      <Text style={styles.footer}>HolyOS · Best Series s.r.o.</Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.xl,
    paddingTop: 80,
  },
  brand: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  brandTitle: {
    color: colors.text,
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: 3,
  },
  brandSubtitle: {
    color: colors.text2,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: {
    color: colors.text2,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 16,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    marginTop: spacing.md,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    color: colors.text2,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 'auto',
    marginBottom: spacing.xl,
  },
});
