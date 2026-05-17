// =============================================================================
// Gate — startovací obrazovka, rozhodne kam jít dál
// =============================================================================
// 1) Načte uložený JWT ze SecureStore.
// 2) Pokud žádný → Login.
// 3) Pokud nějaký, ověří ho voláním /api/velin/me. Když 401 → smaže a Login.
//    Když OK → Tabs (MyDay).

import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { loadAuth, clearAuth } from '../lib/auth';
import { api, ApiError } from '../lib/api';
import { colors } from '../lib/theme';
import type { RootStackParamList } from '../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Gate'>;

export default function Gate({ navigation }: Props) {
  useEffect(() => {
    (async () => {
      const auth = await loadAuth();
      if (!auth.jwt) {
        navigation.replace('Login');
        return;
      }
      try {
        await api.me(auth.jwt);
        navigation.replace('Tabs');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await clearAuth();
        }
        navigation.replace('Login');
      }
    })();
  }, [navigation]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Velín</Text>
      <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 24 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  title: {
    color: colors.text,
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: 2,
  },
});
