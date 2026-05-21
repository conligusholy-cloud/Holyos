// =============================================================================
// ChatThread — konkrétní chat, scroll zpráv + send box
// =============================================================================
// GET /api/velin/chat/channels/:id/messages?limit=50 — posledních 50 zpráv.
// POST /api/velin/chat/channels/:id/messages — odeslat (s optimistic UI).
// POST /api/velin/chat/channels/:id/read — mark read při otevření / focus.
//
// Optimistic send:
//   1) User klikne Odeslat → vytvoříme local message s id 'tmp-<n>', status 'sending'.
//   2) Vyčistíme input, přidáme zprávu do listu okamžitě.
//   3) Pošleme přes API. Po úspěchu nahradíme tmp zprávu reálnou.
//   4) Po failu označíme jako 'failed' s retry tlačítkem (TODO).
//
// Auto-scroll: FlatList inverted (nejnovější dole), nové zprávy "scrollnou" samy.

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { api, ApiError, type ChatMessage } from '../lib/api';
import { loadAuth, clearAuth } from '../lib/auth';
import { colors, radius, spacing } from '../lib/theme';
import type { RootStackParamList } from '../App';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatThread'>;

// Local extension typu pro optimistic UI: tmp zprávy mají status, reálné ne.
type LocalMessage = ChatMessage & {
  _status?: 'sending' | 'sent' | 'failed';
};

export default function ChatThread({ route }: Props) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { channelId, channelTitle } = route.params;

  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [myUserId, setMyUserId] = useState<number | null>(null);
  const mountedRef = useRef(true);
  const tmpCounter = useRef(0);

  useEffect(() => () => { mountedRef.current = false; }, []);

  // Set header title z route paramu
  useEffect(() => {
    navigation.setOptions({
      title: channelTitle || 'Chat',
      headerShown: true,
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.text,
      headerTitleStyle: { color: colors.text, fontWeight: '600' },
    });
  }, [navigation, channelTitle]);

  // Načti historii + mark as read
  const loadMessages = useCallback(async () => {
    const auth = await loadAuth();
    if (!auth.jwt) {
      await clearAuth();
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      return;
    }
    if (mountedRef.current) setMyUserId(auth.personId);

    try {
      const fresh = await api.chatMessages(auth.jwt, channelId);
      if (!mountedRef.current) return;
      setMessages(fresh as LocalMessage[]);
      setError(null);
      // Mark read fire-and-forget
      api.chatMarkRead(auth.jwt, channelId).catch(() => { /* silent */ });
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof ApiError) {
        if (err.status === 401) {
          await clearAuth();
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
          return;
        }
        setError(err.message);
      } else {
        setError('Nepodařilo se načíst zprávy.');
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [channelId, navigation]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Při focus refreshneme (např. po push notif uživatel klikne)
  useFocusEffect(useCallback(() => { loadMessages(); }, [loadMessages]));

  async function handleSend() {
    const content = draft.trim();
    if (!content || sending) return;

    const auth = await loadAuth();
    if (!auth.jwt) return;

    // Optimistic: vytvoř tmp zprávu, hned přidej
    tmpCounter.current += 1;
    const tmpId = `tmp-${Date.now()}-${tmpCounter.current}`;
    const tmpMsg: LocalMessage = {
      id: tmpId,
      channel_id: channelId,
      sender_id: auth.personId,
      sender_type: 'user',
      sender_label: null,
      content,
      attachments: null,
      edited_at: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
      sender: {
        id: auth.personId || 0,
        username: auth.username || '',
        display_name: auth.displayName || auth.username || '',
        person: null,
      },
      _status: 'sending',
    };
    setMessages((prev) => [...prev, tmpMsg]);
    setDraft('');
    setSending(true);

    try {
      const real = await api.chatSend(auth.jwt, channelId, content);
      if (!mountedRef.current) return;
      // Nahraď tmp zprávu reálnou
      setMessages((prev) => prev.map((m) => (m.id === tmpId ? { ...(real as LocalMessage), _status: 'sent' } : m)));
    } catch (err) {
      if (!mountedRef.current) return;
      // Označ jako failed, ať user vidí ! a může retry
      setMessages((prev) => prev.map((m) => (m.id === tmpId ? { ...m, _status: 'failed' } : m)));
      if (err instanceof ApiError && err.status === 401) {
        await clearAuth();
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      }
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }

  if (loading && messages.length === 0) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item, index }) => {
            const prev = index > 0 ? messages[index - 1] : null;
            const sameAuthorAsPrev = prev && prev.sender_id === item.sender_id;
            return (
              <Bubble
                message={item}
                isMe={item.sender_id === myUserId}
                showSenderName={!sameAuthorAsPrev && item.sender_id !== myUserId}
              />
            );
          }}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => { /* auto-scroll na konec — FlatList to dělá samo když je nová položka */ }}
          ListEmptyComponent={
            !loading && !error ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>Začni rozhovor 👋</Text>
              </View>
            ) : null
          }
          ListHeaderComponent={
            error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>⚠ {error}</Text>
              </View>
            ) : null
          }
        />

        <View style={styles.sendBar}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Napiš zprávu…"
            placeholderTextColor={colors.text2}
            multiline
            maxLength={4000}
            editable={!sending}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!draft.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator color="#0b1220" size="small" />
            ) : (
              <Text style={styles.sendBtnText}>Pošli</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function Bubble({
  message,
  isMe,
  showSenderName,
}: {
  message: LocalMessage;
  isMe: boolean;
  showSenderName: boolean;
}) {
  const time = new Date(message.created_at).toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <View style={[styles.bubbleWrap, isMe ? styles.bubbleWrapMe : styles.bubbleWrapOther]}>
      {!isMe && message.sender?.person?.photo_url ? (
        <Image
          source={{ uri: message.sender.person.photo_url }}
          style={styles.bubbleAvatar}
        />
      ) : !isMe ? (
        <View style={[styles.bubbleAvatar, styles.bubbleAvatarFallback]}>
          <Text style={styles.bubbleAvatarInitial}>
            {(message.sender?.display_name || '?').charAt(0).toUpperCase()}
          </Text>
        </View>
      ) : null}

      <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
        {showSenderName && (
          <Text style={styles.bubbleSenderName}>{message.sender?.display_name}</Text>
        )}
        {message.content ? (
          <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{message.content}</Text>
        ) : null}
        {message.attachments && message.attachments.length > 0 && (
          <View style={styles.bubbleAttachments}>
            {message.attachments.map((a, i) => (
              <Text key={i} style={[styles.bubbleAttachmentLabel, isMe && styles.bubbleTextMe]}>
                {a.kind === 'image' ? '📷' : '📎'} {a.name || a.url.split('/').pop()}
              </Text>
            ))}
          </View>
        )}
        <View style={styles.bubbleMeta}>
          <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>{time}</Text>
          {message._status === 'sending' && (
            <Text style={[styles.bubbleStatus, styles.bubbleTimeMe]}> · odesílá se…</Text>
          )}
          {message._status === 'failed' && (
            <Text style={[styles.bubbleStatus, { color: colors.danger }]}> · ! nedoručeno</Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  emptyState: { alignItems: 'center', padding: spacing.xxl },
  emptyText: { color: colors.text2, fontSize: 14 },
  errorBanner: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  errorText: { color: colors.danger, fontSize: 13 },
  bubbleWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: spacing.xs,
  },
  bubbleWrapMe: { justifyContent: 'flex-end' },
  bubbleWrapOther: { justifyContent: 'flex-start' },
  bubbleAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: spacing.xs,
    backgroundColor: colors.surface2,
  },
  bubbleAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  bubbleAvatarInitial: { color: colors.text, fontSize: 12, fontWeight: '700' },
  bubble: {
    maxWidth: '78%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleMe: { backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  bubbleSenderName: {
    color: colors.text2,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  bubbleText: { color: colors.text, fontSize: 15, lineHeight: 20 },
  bubbleTextMe: { color: '#0b1220' },
  bubbleAttachments: { marginTop: spacing.xs },
  bubbleAttachmentLabel: { color: colors.text, fontSize: 13, marginTop: 2 },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  bubbleTime: { color: colors.text2, fontSize: 10 },
  bubbleTimeMe: { color: 'rgba(11,18,32,0.6)' },
  bubbleStatus: { fontSize: 10 },
  sendBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    color: colors.text,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
    marginRight: spacing.sm,
  },
  sendBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
    minHeight: 40,
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#0b1220', fontWeight: '700', fontSize: 15 },
});
