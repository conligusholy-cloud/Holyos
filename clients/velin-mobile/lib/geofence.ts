// =============================================================================
// Velín mobile — background geofencing (Fáze 3)
// =============================================================================
// Auto docházka přes geofence kruhy okolo provozů.
//   • Backend admin definuje GeoFence (lat/lng/radius).
//   • Mobile si seznam stáhne z /api/velin/admin/fences (nebo z my-day endpointu
//     — pro Fázi 3 MVP voláme přímo /admin/fences přes JWT kolegy).
//     POZN: Pokud kolega nemá oprávnění admin GET, je tu fallback na fence info
//     uložené do AsyncStorage při posledním úspěšném načtení.
//   • Expo Location.startGeofencingAsync(taskName, regions) registruje background
//     listener na iOS i Android.
//   • Background TaskManager.defineTask se spustí při entry/exit a pošle punch.
//
// POZOR — background task vyžaduje:
//   1) Always Location permission na iOS (v Settings → Velín → Location → Always)
//   2) ACCESS_BACKGROUND_LOCATION na Android
//   3) FOREGROUND_SERVICE_LOCATION + foreground service notification (Android 14+)
//
// Task NESMÍ používat React state — běží mimo React strom. Volá REST API
// přímo přes fetch + JWT načtený ze SecureStore.

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const GEOFENCE_TASK = 'VELIN_GEOFENCE_TASK';
const GEOFENCE_ENABLED_KEY = 'velin_geofence_enabled';
const FENCES_CACHE_KEY = 'velin_geofence_regions';

const API_BASE: string =
  (Constants.expoConfig?.extra as any)?.apiBase || 'https://app.holyos.cz';

type FenceRegion = {
  identifier: string; // string verze fence id
  latitude: number;
  longitude: number;
  radius: number;
  notifyOnEnter: boolean;
  notifyOnExit: boolean;
};

// =============================================================================
// TaskManager task — běží v background při entry/exit
// =============================================================================
// Toto MUSÍ být na top-level (ne uvnitř komponenty), Expo to vyžaduje, aby
// task přežil restart appky. Definice se zaregistruje při require lib/geofence.
if (!TaskManager.isTaskDefined(GEOFENCE_TASK)) {
  TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[geofence] task error:', error.message);
      return;
    }
    if (!data) return;
    const { eventType, region } = data as {
      eventType: Location.GeofencingEventType;
      region: Location.LocationRegion;
    };
    if (!region) return;

    // Mapování event → punch kind
    let kind: 'in' | 'out' | null = null;
    if (eventType === Location.GeofencingEventType.Enter) kind = 'in';
    else if (eventType === Location.GeofencingEventType.Exit) kind = 'out';
    if (!kind) return;

    // JWT ze SecureStore — kolega musí být přihlášený
    let jwt: string | null = null;
    try {
      jwt = await SecureStore.getItemAsync('holyos_jwt');
    } catch {}
    if (!jwt) {
      console.warn('[geofence] no JWT — kolega odhlášen, vyhazujeme task');
      try { await Location.stopGeofencingAsync(GEOFENCE_TASK); } catch {}
      return;
    }

    // Pošli punch — souřadnice nejsou součástí region objektu, vezmem aktuální
    let lat: number | null = null;
    let lng: number | null = null;
    let accuracy_m: number | null = null;
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
      accuracy_m = pos.coords.accuracy ?? null;
    } catch {
      // Bez GPS — pošlem aspoň event s region centrem
      lat = region.latitude;
      lng = region.longitude;
      accuracy_m = region.radius;
    }

    try {
      const res = await fetch(`${API_BASE}/api/velin/attendance/punch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          kind,
          lat,
          lng,
          accuracy_m,
          source: 'velin_geofence_auto',
        }),
      });
      if (!res.ok) {
        console.warn('[geofence] punch failed:', res.status);
      } else {
        console.log(`[geofence] ✓ auto-punch ${kind} při fence ${region.identifier}`);
      }
    } catch (e: any) {
      console.warn('[geofence] punch network err:', e?.message || e);
    }
  });
}

// =============================================================================
// Public API — volá se z UI
// =============================================================================

export async function isGeofencingEnabled(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(GEOFENCE_ENABLED_KEY);
    if (v !== '1') return false;
    // Ověř, že Expo task ještě běží (mohl být odregistrován např. po restartu)
    return await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
  } catch {
    return false;
  }
}

/**
 * Vyžádá oprávnění Always Location, načte aktivní fences z backendu a spustí
 * geofencing task. Vrátí true při úspěchu, false jinak (chybí permission /
 * žádný fence / network error).
 */
export async function enableGeofencing(): Promise<boolean> {
  try {
    // 1) Foreground povolení
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return false;

    // 2) Background povolení (Always)
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (!bg.granted) return false;

    // 3) Načti fences (z my-day extra nebo dedicated endpoint).
    //    Pro Fázi 3 MVP: kolega volá /api/velin/admin/fences přímo. Pokud
    //    admin endpoint odmítne (requireAuth — kolega má requireVelinAuth JWT
    //    z mobile, který přes admin nepustí), fallback na cache.
    const jwt = await SecureStore.getItemAsync('holyos_jwt');
    if (!jwt) return false;

    let regions: FenceRegion[] = [];
    try {
      const res = await fetch(`${API_BASE}/api/velin/admin/fences`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (res.ok) {
        const body = await res.json();
        const fences = Array.isArray(body?.fences) ? body.fences : [];
        regions = fences
          .filter((f: any) => f.active && typeof f.center_lat === 'number' && typeof f.center_lng === 'number')
          .map((f: any) => ({
            identifier: String(f.id),
            latitude: f.center_lat,
            longitude: f.center_lng,
            radius: Math.max(50, f.radius_m || 150),
            notifyOnEnter: true,
            notifyOnExit: true,
          }));
        // Cache pro fallback
        await AsyncStorage.setItem(FENCES_CACHE_KEY, JSON.stringify(regions));
      } else {
        // Fallback na cache
        const cached = await AsyncStorage.getItem(FENCES_CACHE_KEY);
        if (cached) regions = JSON.parse(cached);
      }
    } catch {
      const cached = await AsyncStorage.getItem(FENCES_CACHE_KEY);
      if (cached) regions = JSON.parse(cached);
    }

    if (regions.length === 0) {
      console.warn('[geofence] žádné aktivní fences');
      return false;
    }

    // 4) Spusť task
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
    await AsyncStorage.setItem(GEOFENCE_ENABLED_KEY, '1');
    return true;
  } catch (e: any) {
    console.warn('[geofence] enable error:', e?.message || e);
    return false;
  }
}

export async function disableGeofencing(): Promise<void> {
  try {
    const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
    if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK);
  } catch (e: any) {
    console.warn('[geofence] disable error:', e?.message || e);
  } finally {
    await AsyncStorage.setItem(GEOFENCE_ENABLED_KEY, '0');
  }
}
