// =============================================================================
// Gate — startovací obrazovka, rozhodne kam jít dál
// =============================================================================
// Strategie: OFFLINE-FIRST.
// 1) Načte uložený JWT ze SecureStore.
// 2) Pokud žádný → Login.
// 3) Pokud nějaký → rovnou Tabs (MyDay). Validace tokenu probíhá až tam:
//    MyDay zavolá /api/velin/my-day a:
//      - 401 → clearAuth + Login (token expiroval / je neplatný)
//      - network/timeout → zobrazí "Zkusit znovu" tlačítko, token nemažeme
//      - 200 → render
//
// Důsledek: Gate je velmi rychlá (jen čtení SecureStore, ~10 ms), žádný
// síťový roundtrip. Appka se otevírá okamžitě jako Slack / Instagram.

import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { loadAuth } from '../lib/auth';
import { colors } from '../lib/theme';
import type { RootStackParamList } from '../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Gate'>;

export default function Gate({ navigation }: Props) {
  useEffect(() => {
    (async () => {
      const auth = await loadAuth();
      if (auth.jwt) {
        navigation.replace('Tabs');
      } else {
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
