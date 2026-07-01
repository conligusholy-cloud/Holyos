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
import { registerForPushNotifications } from '../lib/push';
import { api } from '../lib/api';
import type { RootStackParamList } from '../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Gate'>;

// Fire-and-forget: zaregistruj push token i pro už přihlášeného uživatele.
// Registrace při loginu (Login.tsx) nepokryje uživatele, kteří appku jen
// updatnou (Gate je pustí rovnou do Tabs). Backend registraci dělá idempotentně
// (upsert podle expo_push_token), takže opakované volání při každém startu nevadí.
async function ensurePushRegistered(jwt: string): Promise<void> {
  try {
    const device = await registerForPushNotifications();
    if (device) await api.registerDevice(jwt, device);
  } catch (e: any) {
    console.warn('[Gate] Push registrace selhala:', e?.message || e);
  }
}

export default function Gate({ navigation }: Props) {
  useEffect(() => {
    (async () => {
      const auth = await loadAuth();
      if (auth.jwt) {
        ensurePushRegistered(auth.jwt); // fire-and-forget, neblokuje navigaci
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
