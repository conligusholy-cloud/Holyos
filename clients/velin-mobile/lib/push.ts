// =============================================================================
// Velín mobile — Expo push notifications
// =============================================================================
// Při startu po loginu:
//   1) Zeptáme se uživatele o povolení notifikací (iOS dialog, Android auto).
//   2) Pokud souhlasí, získáme Expo push token (ExponentPushToken[...]).
//   3) Pošleme token na /api/velin/devices/register s JWT — backend ho
//      uloží do DeviceRegistration vázané na Person.
//
// Důležité:
//   - V Expo Go (sandbox) push token funguje, ale produkční push z exp.host
//     mu nepřijde — pro reálný test je potřeba EAS dev build.
//   - On iOS musíme nastavit projectId v getExpoPushTokenAsync — Expo CLI to
//     vygeneruje při `eas init`. Pokud projectId chybí, hodí čitelnou chybu.

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Foreground notification handler — když přijde push s otevřenou aplikací,
// chceme zobrazit banner + heads-up + sound.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type DeviceMeta = {
  expo_push_token: string;
  platform: 'ios' | 'android';
  device_label: string;
  app_version: string;
  os_version: string;
};

export async function registerForPushNotifications(): Promise<DeviceMeta | null> {
  if (!Device.isDevice) {
    console.warn('[push] Expo push pracuje jen na fyzickém zařízení, ne v simulátoru.');
    return null;
  }
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    console.warn('[push] Platforma', Platform.OS, 'není podporovaná.');
    return null;
  }

  // Android notification channel (musí být před getExpoPushTokenAsync)
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Velín',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#6366F1',
    });
  }

  // Permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('[push] Uživatel nepovolil notifikace.');
    return null;
  }

  // Project ID — povinné v EAS buildech, volitelné v Expo Go (přebírá se z app.json)
  const projectId =
    (Constants?.expoConfig as any)?.extra?.eas?.projectId ||
    (Constants?.easConfig as any)?.projectId;

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return {
      expo_push_token: tokenData.data,
      platform: Platform.OS as 'ios' | 'android',
      device_label: Device.deviceName || `${Device.manufacturer || ''} ${Device.modelName || ''}`.trim(),
      app_version: Application.nativeApplicationVersion || Constants.expoConfig?.version || '0.0.0',
      os_version: `${Platform.OS} ${Device.osVersion || ''}`.trim(),
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    // Android bez nakonfigurovaného FCM (chybí google-services.json + EAS FCM
    // credentials) → getExpoPushTokenAsync vyhodí chybu a zařízení se nikdy
    // nezaregistruje na backendu (nebude vidět v modulu Velín → Zařízení).
    if (Platform.OS === 'android') {
      console.error(
        '[push] Android: nepodařilo se získat Expo push token. ' +
        'Nejspíš chybí FCM (google-services.json + EAS FCM V1 credentials). Detail:',
        msg
      );
    } else {
      console.error('[push] Nepodařilo se získat Expo push token:', msg);
    }
    return null;
  }
}
