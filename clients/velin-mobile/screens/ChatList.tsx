// =============================================================================
// ChatList — seznam mých chat kanálů (DM, skupiny, task chaty)
// =============================================================================
// GET /api/velin/chat/channels → ChatChannelSummary[] s unread count.
// Tap na kanál → ChatThread.
//
// Strategie: STALE-WHILE-REVALIDATE (stejně jako MyDay).
//   1) Při mountu načti cache → render hned, žádný spinner.
//   2) Paralelně volej API.
//   3) Při úspěchu nahraď + ulož.
//   4) Při network error necháme cache + banner "Server neodpovídá".
//   5) Při 401 → clearAuth + reset na Login.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { api, ApiError, type ChatChannelSummary } from '../lib/api';
import { loadAuth, clearAuth } from '../lib/auth';
import { getCache, setCache, formatCacheAge } from '../lib/cache';
import { colors, radius, spacing } from '../lib/theme';
import type { RootStackParamList } from '../App';

type LoadError =
  | { kind: 'network' }
  | { kind: 'server'; message: string };

function cacheKey(personId: number | null) {
  return `chat-channels:${personId ?? 'unknown'}`;
}

// Renderovat label kanálu — pro DM vezmi protistranu, jinak channel.name
function channelLabel(ch: ChatChannelSummary, myUserId: number | null): string {
  if (ch.type === 'direct') {
    const other = ch.members.find((m) => m.user_id !== myUserId);
    return other?.user.display_name || other?.user.username || 'Zpráva';
  }
  return ch.name || (ch.type === 'task' ? 'Úkol' : 'Skupina');
}

// Avatar URL pro direct channel — fotka protistrany; pro group null (ukážeme iniciálu)
function channelAvatar(ch: ChatChannelSummary, myUserId: number | null): string | null {
  if (ch.type === 'direct') {
    const other = ch.members.find((m) => m.user_id !== myUserId);
    return other?.user.person?.photo_url || null;
  }
  return null;
}

// "12:34" pro dnes, "Po 14:25" pro tento týden, jinak "21. 5."
function formatLastMessageTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  }
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (24 * 3600 * 1000));
  if (diffDays < 7) {
    return d.toLocaleDateString('cs-CZ', { weekday: 'short' }) +
      ' ' + d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
}

function previewLastMessage(ch: ChatChannelSummary): string {
  const m = ch.last_message;
  if (!m) return 'Žádné zprávy';
  if (m.content) return m.content;
  if (m.attachments && m.attachments.length > 0) {
    const hasImg = m.attachments.some((a) => a.kind === 'image');
    return hasImg ? `📷 Obrázek (${m.attachments.length})` : `📎 Soubor (${m.attachments.length})`;
  }
  return 'Žádné zprávy';
}

export default function ChatList() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [channels, setChannels] = useState<ChatChannelSummary[]>([]);
  const [myUserId, setMyUserId] = useState<number | null>(null);
  const [cacheAge, setCacheAge] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async (mode: 'mount' | 'refresh') => {
    const auth = await loadAuth();
    if (!auth.jwt) {
      await clearAuth();
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      return;
    }
    // myUserId = User.id (ChatChannelMember.user_id je taky User.id z backendu).
    // NE personId — chat ownership běží přes User model.
    if (mountedRef.current) setMyUserId(auth.userId);

    const key = cacheKey(auth.personId);

    if (mode === 'mount') {
      const cached = await getCache<ChatChannelSummary[]>(key);
      if (cached && mountedRef.current) {
        setChannels(cached.value);
        setCacheAge(formatCacheAge(cached.savedAt));
        setLoading(false);
      }
    }

    try {
      const fresh = await api.chatChannels(auth.jwt);
      if (!mountedRef.current) return;
      setChannels(fresh);
      setCacheAge(null);
      setError(null);
      await setCache(key, fresh);
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ApiError) {
        if (err.status === 401) {
          await clearAuth();
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
          return;
        }
        if (err.status === 0) setError({ kind: 'network' });
        else setError({ kind: 'server', message: err.message });
      } else {
        setError({ kind: 'server', message: 'Nepodařilo se načíst chaty.' });
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [navigation]);

  useEffect(() => {
    load('mount');
  }, [load]);

  useFocusEffect(useCallback(() => { load('refresh'); }, [load]));

  function openChannel(ch: ChatChannelSummary) {
    navigation.navigate('ChatThread', {
      channelId: ch.id,
      channelTitle: channelLabel(ch, myUserId),
    });
  }

  function handleRetry() {
    setError(null);
    load('refresh');
  }

  if (loading && channels.length === 0) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (channels.length === 0 && error && error.kind === 'network') {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <View style={styles.retryBox}>
          <Text style={styles.retryEmoji}>📡</Text>
          <Text style={styles.retryTitle}>Server neodpovídá</Text>
          <Text style={styles.retrySub}>Zkus to znovu, zůstáváš přihlášen.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
            <Text style={styles.retryBtnText}>Zkusit znovu</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const hasStale = channels.length > 0 && (cacheAge !== null || error !== null);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load('refresh');
            }}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.headerRow}>
          <Text style={styles.header}>Chat</Text>
          <TouchableOpacity
            style={styles.newChatBtn}
            onPress={() => navigation.navigate('NewChat')}
            activeOpacity={0.7}
          >
            <Text style={styles.newChatBtnText}>✏️  Nová</Text>
          </TouchableOpacity>
        </View>

        {hasStale && (
          <TouchableOpacity onPress={handleRetry} style={styles.staleBanner} activeOpacity={0.7}>
            <Text style={styles.staleBannerText}>
              {error && error.kind === 'network'
                ? `📡 Server neodpovídá${cacheAge ? ` · ${cacheAge}` : ''}`
                : error && error.kind === 'server'
                ? `⚠ ${error.message}`
                : `🕓 Naposledy obnoveno ${cacheAge}`}
            </Text>
            <Text style={styles.staleBannerHint}>Klepni pro obnovení</Text>
          </TouchableOpacity>
        )}

        {channels.length === 0 && !error && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>Zatím žádné zprávy.</Text>
            <Text style={styles.emptyTextSmall}>
              Nové konverzace přijdou s push notifikací, jakmile ti někdo napíše.
            </Text>
          </View>
        )}

        {channels.map((ch) => (
          <ChannelRow
            key={ch.id}
            channel={ch}
            myUserId={myUserId}
            onPress={() => openChannel(ch)}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function ChannelRow({
  channel,
  myUserId,
  onPress,
}: {
  channel: ChatChannelSummary;
  myUserId: number | null;
  onPress: () => void;
}) {
  const label = channelLabel(channel, myUserId);
  const avatar = channelAvatar(channel, myUserId);
  const initial = (label || '?').charAt(0).toUpperCase();

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.65}>
      <View style={styles.avatarWrap}>
        {avatar ? (
          <Image source={{ uri: avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{initial}</Text>
          </View>
        )}
        {channel.unread > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>
              {channel.unread > 99 ? '99+' : String(channel.unread)}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.rowMain}>
        <View style={styles.rowHead}>
          <Text style={[styles.rowTitle, channel.unread > 0 && styles.rowTitleUnread]} numberOfLines={1}>
            {label}
            {channel.type === 'group' ? ' 👥' : channel.type === 'task' ? ' 🛠' : ''}
          </Text>
          <Text style={styles.rowTime}>{formatLastMessageTime(channel.last_message_at)}</Text>
        </View>
        <Text
          style={[styles.rowPreview, channel.unread > 0 && styles.rowPreviewUnread]}
          numberOfLines={1}
        >
          {previewLastMessage(channel)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: 48 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  header: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
  },
  newChatBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  newChatBtnText: {
    color: '#0b1220',
    fontSize: 14,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  emptyText: { color: colors.text, fontSize: 15, fontWeight: '500' },
  emptyTextSmall: {
    color: colors.text2,
    fontSize: 12,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatarWrap: {
    position: 'relative',
    marginRight: spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface2,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  unreadBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: colors.accent,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  unreadBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  rowMain: { flex: 1, minWidth: 0 },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  rowTitle: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '500', marginRight: spacing.sm },
  rowTitleUnread: { fontWeight: '700' },
  rowTime: { color: colors.text2, fontSize: 11 },
  rowPreview: { color: colors.text2, fontSize: 13 },
  rowPreviewUnread: { color: colors.text, fontWeight: '500' },
  staleBanner: {
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  staleBannerText: { color: colors.text, fontSize: 13, fontWeight: '500' },
  staleBannerHint: { color: colors.text2, fontSize: 11, marginTop: 2 },
  retryBox: { alignItems: 'center', paddingHorizontal: spacing.xl, maxWidth: 320 },
  retryEmoji: { fontSize: 48, marginBottom: spacing.md },
  retryTitle: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: spacing.sm },
  retrySub: { color: colors.text2, fontSize: 14, textAlign: 'center', marginBottom: spacing.xl },
  retryBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  retryBtnText: { color: '#0b1220', fontSize: 15, fontWeight: '700' },
});
