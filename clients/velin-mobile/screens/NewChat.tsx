// =============================================================================
// NewChat — výběr kolegy pro novou DM
// =============================================================================
// GET /api/velin/chat/users/searchable?q=… — seznam aktivních kolegů.
// POST /api/velin/chat/channels/direct { user_id } — otevři/vytvoř DM.
// Po vytvoření channelu navigation.replace na ChatThread, aby
// back button ze ChatThread vedl zpátky do ChatList, ne sem.
//
// Search je debounced (300 ms) — server fulltext přes display_name/username.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api, ApiError, type SearchableUser } from '../lib/api';
import { loadAuth, clearAuth } from '../lib/auth';
import { colors, radius, spacing } from '../lib/theme';
import type { RootStackParamList } from '../App';

export default function NewChat() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<SearchableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<number | null>(null); // user_id právě otvírané DM
  const [error, setError] = useState<string | null>(null);

  // Header se vrátí zpět šipkou (React Navigation default)
  useEffect(() => {
    navigation.setOptions({
      title: 'Nová zpráva',
      headerShown: true,
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.text,
      headerTitleStyle: { color: colors.text, fontWeight: '600' },
    });
  }, [navigation]);

  // Debounced search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      fetchUsers(query);
    }, 300);
    return () => clearTimeout(timeoutId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const fetchUsers = useCallback(async (q: string) => {
    const auth = await loadAuth();
    if (!auth.jwt) {
      await clearAuth();
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.chatSearchableUsers(auth.jwt, q);
      setUsers(result);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          await clearAuth();
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
          return;
        }
        setError(err.message);
      } else {
        setError('Nepodařilo se načíst kolegy.');
      }
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  async function openOrCreateDM(user: SearchableUser) {
    const auth = await loadAuth();
    if (!auth.jwt) return;

    setCreating(user.id);
    try {
      const { channel } = await api.chatDirectChannel(auth.jwt, user.id);
      // Replace, ne navigate — uživatel se ze ChatThread vrátí přímo do ChatList
      navigation.replace('ChatThread', {
        channelId: channel.id,
        channelTitle: user.display_name || user.username,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await clearAuth();
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        return;
      }
      const msg = err instanceof ApiError ? err.message : 'Nepodařilo se otevřít chat.';
      setError(msg);
    } finally {
      setCreating(null);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <View style={styles.searchWrap}>
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder="Hledat kolegu…"
            placeholderTextColor={colors.text2}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>⚠ {error}</Text>
          </View>
        ) : null}

        <FlatList
          data={users}
          keyExtractor={(u) => String(u.id)}
          renderItem={({ item }) => (
            <UserRow
              user={item}
              creating={creating === item.id}
              onPress={() => openOrCreateDM(item)}
            />
          )}
          ListEmptyComponent={
            loading ? (
              <View style={styles.center}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  {query ? 'Nikoho jsem nenašel.' : 'Žádní kolegové k zobrazení.'}
                </Text>
              </View>
            )
          }
          contentContainerStyle={{ paddingBottom: spacing.xl }}
        />
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function UserRow({
  user,
  creating,
  onPress,
}: {
  user: SearchableUser;
  creating: boolean;
  onPress: () => void;
}) {
  const photo = user.person?.photo_url;
  const fullName = user.person
    ? `${user.person.first_name || ''} ${user.person.last_name || ''}`.trim()
    : '';
  const label = user.display_name || fullName || user.username;
  const initial = (label || '?').charAt(0).toUpperCase();

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      disabled={creating}
      activeOpacity={0.65}
    >
      {photo ? (
        <Image source={{ uri: photo }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>{initial}</Text>
        </View>
      )}
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>{label}</Text>
        {fullName && fullName !== label ? (
          <Text style={styles.rowSub} numberOfLines={1}>{fullName}</Text>
        ) : (
          <Text style={styles.rowSub} numberOfLines={1}>@{user.username}</Text>
        )}
      </View>
      {creating ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <Text style={styles.rowArrow}>›</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  searchWrap: { padding: spacing.md, backgroundColor: colors.surface },
  search: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 15,
  },
  center: { padding: spacing.xl, alignItems: 'center' },
  empty: { padding: spacing.xl, alignItems: 'center' },
  emptyText: { color: colors.text2, fontSize: 14 },
  errorBanner: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    margin: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  errorText: { color: colors.danger, fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: spacing.md,
    backgroundColor: colors.surface2,
  },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: colors.text, fontSize: 18, fontWeight: '700' },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '500' },
  rowSub: { color: colors.text2, fontSize: 12, marginTop: 2 },
  rowArrow: { color: colors.text2, fontSize: 22, marginLeft: spacing.sm },
});
