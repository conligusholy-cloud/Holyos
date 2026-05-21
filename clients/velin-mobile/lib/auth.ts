// =============================================================================
// Velín mobile — auth storage (SecureStore)
// =============================================================================
// Persistujeme:
//   - holyos_jwt        — token z /api/auth/login (default JWT_EXPIRY=30d)
//   - holyos_user_id    — User.id (pro chat ownership, push routing)
//   - holyos_person_id  — Person.id (pro UI obrazovky, my-day)
//   - holyos_display_name — pro hezký pozdrav
//   - holyos_username   — fallback identifikace
//
// SecureStore je šifrovaný Keychain (iOS) / EncryptedSharedPreferences (Android).
// Při odhlášení mažeme všechno.

import * as SecureStore from 'expo-secure-store';

const KEY_JWT = 'holyos_jwt';
const KEY_USER_ID = 'holyos_user_id';
const KEY_PERSON_ID = 'holyos_person_id';
const KEY_DISPLAY_NAME = 'holyos_display_name';
const KEY_USERNAME = 'holyos_username';

export type AuthSnapshot = {
  jwt: string | null;
  userId: number | null;
  personId: number | null;
  displayName: string | null;
  username: string | null;
};

export async function saveAuth(snapshot: {
  jwt: string;
  userId: number;
  personId: number;
  displayName: string;
  username: string;
}): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEY_JWT, snapshot.jwt),
    SecureStore.setItemAsync(KEY_USER_ID, String(snapshot.userId)),
    SecureStore.setItemAsync(KEY_PERSON_ID, String(snapshot.personId)),
    SecureStore.setItemAsync(KEY_DISPLAY_NAME, snapshot.displayName),
    SecureStore.setItemAsync(KEY_USERNAME, snapshot.username),
  ]);
}

export async function loadAuth(): Promise<AuthSnapshot> {
  const [jwt, userId, personId, displayName, username] = await Promise.all([
    SecureStore.getItemAsync(KEY_JWT),
    SecureStore.getItemAsync(KEY_USER_ID),
    SecureStore.getItemAsync(KEY_PERSON_ID),
    SecureStore.getItemAsync(KEY_DISPLAY_NAME),
    SecureStore.getItemAsync(KEY_USERNAME),
  ]);
  return {
    jwt: jwt || null,
    userId: userId ? parseInt(userId, 10) : null,
    personId: personId ? parseInt(personId, 10) : null,
    displayName: displayName || null,
    username: username || null,
  };
}

export async function clearAuth(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_JWT),
    SecureStore.deleteItemAsync(KEY_USER_ID),
    SecureStore.deleteItemAsync(KEY_PERSON_ID),
    SecureStore.deleteItemAsync(KEY_DISPLAY_NAME),
    SecureStore.deleteItemAsync(KEY_USERNAME),
  ]);
}
